package mesh

import (
	"testing"
	"time"

	"github.com/datum-labs/compute-network-demo/internal/datum"
)

func TestPush(t *testing.T) {
	l := &Live{PushToken: "s3cret", instances: []datum.Instance{{Name: "a-0"}}}
	if err := l.Push("wrong", LocalReport{Name: "a-0"}); err != errPushDenied {
		t.Fatalf("wrong token: %v", err)
	}
	if err := l.Push("s3cret", LocalReport{Name: "zzz"}); err != errPushUnknown {
		t.Fatalf("unknown: %v", err)
	}
	if err := l.Push("s3cret", LocalReport{Name: "a-0", StartedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if r, err := l.pushedReport(nil, datum.Instance{Name: "a-0"}); err != nil || r.Name != "a-0" {
		t.Fatalf("lookup: %v %v", r, err)
	}
	l.pushed["a-0"] = pushedReport{at: time.Now().Add(-time.Minute)}
	if _, err := l.pushedReport(nil, datum.Instance{Name: "a-0"}); err == nil {
		t.Fatal("stale report accepted")
	}
}
