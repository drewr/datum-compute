package mesh

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/datum-labs/compute-network-demo/internal/datum"
	"github.com/datum-labs/compute-network-demo/internal/geo"
)

// Source produces the fleet view and this instance's own report.
type Source interface {
	View(ctx context.Context) View
	Local() LocalReport
}

// InstanceLister is the discovery dependency of Live.
type InstanceLister interface {
	ListInstances(ctx context.Context, workload string) ([]datum.Instance, error)
	ListLocations(ctx context.Context) ([]geo.Place, error)
}

// Discovery sources reported in the view.
const (
	DiscoveryAPI       = "datum-api"
	DiscoveryStatic    = "static"
	DiscoverySimulated = "simulated"
)

// Live discovers the workload's instances through the Datum Cloud API,
// measures traffic to each of them, and collects their measurements to show
// the whole mesh.
type Live struct {
	// API is the primary discovery source; it may be nil when no credentials
	// are available.
	API InstanceLister
	// StaticPeers is used whenever the API is absent or unreachable, for
	// networks without a route to the Datum Cloud API.
	StaticPeers       []datum.Instance
	Project, Workload string
	Port              int
	Pinger            *Pinger
	Directory         *geo.Directory
	DiscoverEvery     time.Duration
	LocationsEvery    time.Duration
	CacheFor          time.Duration
	PeerReportTimeout time.Duration
	// LocalAddrs and Hostname identify this instance; they default to the
	// machine's interfaces and hostname.
	LocalAddrs func() []netip.Addr
	Hostname   string
	// SelfName, when set, names this instance outright instead of working it
	// out from addresses. Useful when several instances share a host.
	SelfName string
	// SelfLocation places SelfName when discovery cannot list this instance,
	// as with a static peer list that cannot know this instance's address.
	SelfLocation string
	// PushToken, when set, turns on push mode: peers that cannot be reached
	// from this instance send their own reports to POST /mesh/report with this
	// bearer token, and this instance neither pings nor polls them.
	PushToken string
	// Driver, when set, lets one replica of the fleet scale the workload it
	// belongs to. It is opt-in and uses its own credentials, so the read-only
	// identity the page runs under stays read-only.
	Driver *Driver

	startedAt time.Time
	client    *http.Client

	mu           sync.RWMutex
	instances    []datum.Instance
	self         string
	selfLocation string
	discoverErr  error
	discovered   bool
	discovery    string

	viewMu    sync.Mutex
	cached    View
	cachedAt  time.Time
	activity  *activityLog
	joins     *joinTracker
	fetchPeer func(ctx context.Context, inst datum.Instance) (*LocalReport, error)

	pushMu sync.Mutex
	pushed map[string]pushedReport
}

type pushedReport struct {
	report LocalReport
	at     time.Time
}

// pushFreshness is how long a pushed report counts as current.
const pushFreshness = 30 * time.Second

// Push records a report a peer sent about itself. It returns an error for a
// wrong token or an instance that is not part of the fleet.
func (l *Live) Push(token string, r LocalReport) error {
	if l.PushToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(l.PushToken)) != 1 {
		return errPushDenied
	}
	l.mu.RLock()
	known := false
	for _, inst := range l.instances {
		known = known || inst.Name == r.Name
	}
	l.mu.RUnlock()
	if !known {
		return errPushUnknown
	}
	l.pushMu.Lock()
	defer l.pushMu.Unlock()
	if l.pushed == nil {
		l.pushed = map[string]pushedReport{}
	}
	l.pushed[r.Name] = pushedReport{report: r, at: time.Now()}
	return nil
}

var (
	errPushDenied  = errors.New("push denied")
	errPushUnknown = errors.New("unknown instance")
)

func (l *Live) pushedReport(_ context.Context, inst datum.Instance) (*LocalReport, error) {
	l.pushMu.Lock()
	defer l.pushMu.Unlock()
	p, ok := l.pushed[inst.Name]
	if !ok || time.Since(p.at) > pushFreshness {
		return nil, errors.New("no recent report")
	}
	r := p.report
	return &r, nil
}

// Start begins discovery and traffic. It returns immediately.
func (l *Live) Start(ctx context.Context) {
	l.startedAt = time.Now()
	if l.LocalAddrs == nil {
		l.LocalAddrs = LocalAddrs
	}
	if l.Hostname == "" {
		l.Hostname, _ = os.Hostname()
	}
	l.client = &http.Client{Timeout: l.PeerReportTimeout}
	if l.fetchPeer == nil {
		l.fetchPeer = l.fetchPeerReport
		if l.PushToken != "" {
			l.fetchPeer = l.pushedReport
		}
	}
	go l.discoverLoop(ctx)
	go l.locationsLoop(ctx)
	go l.Pinger.Run(ctx)
}

func (l *Live) discoverLoop(ctx context.Context) {
	ticker := time.NewTicker(l.DiscoverEvery)
	defer ticker.Stop()
	for {
		l.discover(ctx)
		// The driver re-runs its election on every discovery tick, and reads
		// the assembled view because its safety checks are about reachability
		// rather than about what the API last reported. It runs alongside
		// discovery rather than inside it, so an API call of its own never
		// delays the next look at the fleet.
		if l.Driver != nil {
			go func() {
				tick, cancel := context.WithTimeout(ctx, driverTickTimeout)
				defer cancel()
				l.Driver.Tick(tick, l.View(tick))
			}()
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// driverTickTimeout bounds one driver tick: a read, a decision and at most one
// write.
const driverTickTimeout = 30 * time.Second

func (l *Live) discover(ctx context.Context) {
	timeout := 10 * time.Second
	if len(l.StaticPeers) > 0 {
		// A fallback exists, so don't leave the mesh waiting on the API.
		timeout = 4 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var instances []datum.Instance
	err := errNoDiscovery
	source := DiscoveryAPI
	if l.API != nil {
		instances, err = l.API.ListInstances(ctx, l.Workload)
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	if err != nil && l.API != nil && (l.discoverErr == nil || l.discoverErr.Error() != err.Error()) {
		slog.Warn("instance discovery through the Datum Cloud API failed", "error", err, "staticPeers", len(l.StaticPeers))
	}
	if err != nil && len(l.StaticPeers) > 0 {
		instances, err, source = l.StaticPeers, nil, DiscoveryStatic
	}
	if err != nil {
		l.discoverErr = err
		return
	}
	if source != l.discovery {
		slog.Info("discovering instances", "source", source, "count", len(instances))
	}
	if l.SelfName != "" && l.SelfLocation != "" {
		instances = withSelf(instances, l.SelfName, l.SelfLocation)
	}
	l.discoverErr = nil
	l.discovered = true
	l.discovery = source
	l.instances = instances

	self := l.SelfName
	if self == "" {
		self = FindSelf(instances, l.LocalAddrs(), l.Hostname)
	}
	if self != l.self {
		slog.Info("identified self", "instance", self)
	}
	l.self = self

	peers := make([]Peer, 0, len(instances))
	for _, inst := range instances {
		if inst.Name == self {
			l.selfLocation = inst.Location
			continue
		}
		if inst.PrivateIP.IsValid() {
			peers = append(peers, Peer{Name: inst.Name, Addr: inst.PrivateIP})
		}
	}
	if l.PushToken == "" {
		l.Pinger.SetPeers(peers)
	}
}

func (l *Live) locationsLoop(ctx context.Context) {
	ticker := time.NewTicker(l.LocationsEvery)
	defer ticker.Stop()
	if l.API == nil {
		return
	}
	for {
		lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		places, err := l.API.ListLocations(lctx)
		cancel()
		if err != nil {
			// The built-in table covers every published location.
			slog.Debug("location lookup failed, using built-in table", "error", err)
		} else {
			l.Directory.Update(places)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Local returns this instance's own measurements.
func (l *Live) Local() LocalReport {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return LocalReport{
		Name:      l.self,
		Location:  l.selfLocation,
		StartedAt: l.startedAt,
		Peers:     l.Pinger.Stats(),
		Exchanges: l.Pinger.Exchanges(MaxFeedExchanges),
	}
}

// View assembles the fleet view, reusing a recent result so many viewers do
// not multiply traffic on the private network.
func (l *Live) View(ctx context.Context) View {
	l.viewMu.Lock()
	defer l.viewMu.Unlock()
	if !l.cachedAt.IsZero() && time.Since(l.cachedAt) < l.CacheFor {
		return l.cached
	}

	l.mu.RLock()
	instances := l.instances
	self := l.self
	discoverErr := l.discoverErr
	discovered := l.discovered
	discovery := l.discovery
	l.mu.RUnlock()

	reports := map[string]*LocalReport{}
	var rmu sync.Mutex
	var wg sync.WaitGroup
	for _, inst := range instances {
		if inst.Name == self {
			local := l.Local()
			reports[inst.Name] = &local
			continue
		}
		if !inst.PrivateIP.IsValid() {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := l.fetchPeer(ctx, inst)
			if err != nil || r == nil {
				return
			}
			rmu.Lock()
			reports[inst.Name] = r
			rmu.Unlock()
		}()
	}
	wg.Wait()

	v := Assemble(instances, l.Directory, self, reports, time.Now())
	// The join time comes from the fleet's own observations, so it is settled
	// before the activity log decides an Instance has joined the mesh.
	if l.joins == nil {
		l.joins = newJoinTracker()
	}
	l.joins.observe(&v, instances, v.GeneratedAt)
	if l.activity == nil {
		l.activity = newActivityLog()
	}
	l.activity.observe(v.Instances, v.GeneratedAt)
	v.Activity = l.activity.recent()
	v.Mode = "live"
	v.Discovery = discovery
	v.Project = l.Project
	v.Workload = l.Workload
	if l.Driver != nil {
		state := l.Driver.State()
		v.Driver = &state
	}
	switch {
	case !discovered && discoverErr != nil:
		v.Notice = "Connecting to the Datum Cloud API to discover instances…"
	case !discovered:
		v.Notice = "Discovering instances…"
	case discoverErr != nil:
		v.Notice = "Showing the last known fleet while reconnecting to the Datum Cloud API."
	}

	l.cached = v
	l.cachedAt = time.Now()
	return v
}

func (l *Live) fetchPeerReport(ctx context.Context, inst datum.Instance) (*LocalReport, error) {
	ctx, cancel := context.WithTimeout(ctx, l.PeerReportTimeout)
	defer cancel()
	u := "http://" + net.JoinHostPort(inst.PrivateIP.String(), strconv.Itoa(l.Port)) + "/mesh/local"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, &httpError{status: resp.Status}
	}
	var r LocalReport
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&r); err != nil {
		return nil, err
	}
	// The peer may not have identified itself yet; discovery knows its name.
	r.Name = inst.Name
	return &r, nil
}

var errNoDiscovery = errors.New("no discovery source configured")

// ParseStaticPeers reads MESH_PEERS: comma-separated location=address
// entries such as "us-central-1=fd20:0:12::2:0:0,us-east-1=fd20:0:12:1:0:1::".
// Names are derived from the location and the entry's position within it, so
// every instance given the same list agrees on every peer's name.
func ParseStaticPeers(spec string) ([]datum.Instance, error) {
	var out []datum.Instance
	perLocation := map[string]int{}
	for _, entry := range strings.Split(spec, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		location, address, ok := strings.Cut(entry, "=")
		location, address = strings.TrimSpace(location), strings.TrimSpace(address)
		if !ok || location == "" {
			return nil, fmt.Errorf("MESH_PEERS entry %q: want location=address", entry)
		}
		prefix, ok := datum.ParseAddress(address)
		if !ok {
			return nil, fmt.Errorf("MESH_PEERS entry %q: invalid address", entry)
		}
		out = append(out, datum.Instance{
			Name:      fmt.Sprintf("%s-%d", location, perLocation[location]),
			Location:  location,
			PrivateIP: prefix.Addr(),
			Prefix:    prefix,
			Available: true,
		})
		perLocation[location]++
	}
	return out, nil
}

type httpError struct{ status string }

func (e *httpError) Error() string { return "peer report: " + e.status }

// withSelf adds this instance to a discovered fleet that does not list it.
func withSelf(instances []datum.Instance, name, location string) []datum.Instance {
	for _, inst := range instances {
		if inst.Name == name {
			return instances
		}
	}
	out := append([]datum.Instance(nil), instances...)
	return append(out, datum.Instance{Name: name, Location: location, Available: true})
}
