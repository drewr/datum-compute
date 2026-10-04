//! Stateless IPv4/IPv6 translation for the exit node (RFC 7915, as a CLAT).
//!
//! Instances have no IPv4, but the network provides NAT64 at 64:ff9b::/96. A
//! laptop sends IPv4 from 192.0.0.2; the gateway rewrites each packet as IPv6
//! from the laptop's translation address to the IPv4 destination embedded in
//! the NAT64 prefix, and rewrites the replies back. TCP, UDP and ICMP echo
//! are translated, and so are the ICMP errors that path MTU discovery and
//! traceroute depend on. Fragments and IPv4 options-only protocols are dropped.

use std::net::{Ipv4Addr, Ipv6Addr};

/// The laptop's IPv4 address on its tun (RFC 7335's address for a CLAT).
pub const CLAT_V4: Ipv4Addr = Ipv4Addr::new(192, 0, 0, 2);

/// TCP MSS for translated flows: a 1280-byte IPv6 packet, the tun MTU.
const MAX_MSS: u16 = 1280 - 40 - 20;

/// IPv4 packet -> IPv6 packet, or None if it can't or shouldn't be translated.
pub fn v4_to_v6(p: &[u8], src6: Ipv6Addr, prefix: Ipv6Addr) -> Option<Vec<u8>> {
    if p.len() < 20 || p[0] >> 4 != 4 {
        return None;
    }
    let ihl = (p[0] & 0x0f) as usize * 4;
    let total = u16::from_be_bytes([p[2], p[3]]) as usize;
    if ihl < 20 || total < ihl || total > p.len() {
        return None;
    }
    if u16::from_be_bytes([p[6], p[7]]) & 0x3fff != 0 {
        return None; // fragment
    }
    let (tos, ttl, proto) = (p[1], p[8], p[9]);
    if ttl <= 1 {
        return None;
    }
    let dst6 = embed(prefix, [p[16], p[17], p[18], p[19]]);
    let mut payload = p[ihl..total].to_vec();
    let next = match proto {
        6 => {
            if payload.len() < 20 {
                return None;
            }
            clamp_mss(&mut payload);
            6
        }
        17 if payload.len() >= 8 => 17,
        1 if payload.len() >= 8 => {
            payload[0] = match payload[0] {
                8 => 128,
                0 => 129,
                _ => return None,
            };
            58
        }
        _ => return None,
    };
    set_v6_checksum(&mut payload, next, &src6, &dst6);
    Some(v6_packet(tos, ttl - 1, next, &src6, &dst6, &payload))
}

/// IPv6 packet from the NAT64 prefix -> IPv4 packet to `dst4`.
pub fn v6_to_v4(p: &[u8], prefix: Ipv6Addr, dst4: Ipv4Addr) -> Option<Vec<u8>> {
    if p.len() < 40 || p[0] >> 4 != 6 {
        return None;
    }
    let plen = u16::from_be_bytes([p[4], p[5]]) as usize;
    let (next, hlim) = (p[6], p[7]);
    if hlim <= 1 || 40 + plen > p.len() {
        return None;
    }
    let src4 = extract(prefix, &p[8..24])?;
    let tos = (p[0] << 4) | (p[1] >> 4);
    let mut payload = p[40..40 + plen].to_vec();
    let proto = match next {
        6 if payload.len() >= 20 => 6,
        17 if payload.len() >= 8 => 17,
        58 if payload.len() >= 8 => {
            payload = icmp6_to_icmp4(&payload, prefix, dst4)?;
            1
        }
        _ => return None,
    };
    set_v4_checksum(&mut payload, proto, src4, dst4);
    v4_packet(tos, hlim - 1, proto, src4, dst4, &payload)
}

/// The IPv6 address of `v4` inside a /96 NAT64 prefix.
pub fn embed(prefix: Ipv6Addr, v4: [u8; 4]) -> Ipv6Addr {
    let mut o = prefix.octets();
    o[12..].copy_from_slice(&v4);
    Ipv6Addr::from(o)
}

fn extract(prefix: Ipv6Addr, a: &[u8]) -> Option<Ipv4Addr> {
    (a[..12] == prefix.octets()[..12]).then(|| Ipv4Addr::new(a[12], a[13], a[14], a[15]))
}

fn icmp6_to_icmp4(m: &[u8], prefix: Ipv6Addr, dst4: Ipv4Addr) -> Option<Vec<u8>> {
    let (ty, code) = (m[0], m[1]);
    let mut out = m.to_vec();
    match ty {
        128 | 129 => {
            out[0] = if ty == 128 { 8 } else { 0 };
            return Some(out);
        }
        1 => {
            out[0] = 3;
            out[1] = match code {
                1 => 10, // administratively prohibited
                4 => 3,  // port unreachable
                _ => 1,  // host unreachable
            };
            out[4..8].fill(0);
        }
        2 => {
            let mtu6 = u32::from_be_bytes([m[4], m[5], m[6], m[7]]);
            let mtu4 = mtu6.saturating_sub(20).clamp(68, 65535) as u16;
            out[0] = 3;
            out[1] = 4; // fragmentation needed
            out[4..6].fill(0);
            out[6..8].copy_from_slice(&mtu4.to_be_bytes());
        }
        3 => {
            out[0] = 11;
            out[4..8].fill(0);
        }
        _ => return None,
    }
    // Errors carry the start of the packet that caused them; translate its header.
    let inner = inner6_to_inner4(&m[8..], prefix, dst4)?;
    out.truncate(8);
    out.extend_from_slice(&inner);
    Some(out)
}

/// The quoted IPv6 header inside an ICMPv6 error, back to the laptop's IPv4.
fn inner6_to_inner4(q: &[u8], prefix: Ipv6Addr, src4: Ipv4Addr) -> Option<Vec<u8>> {
    if q.len() < 40 || q[0] >> 4 != 6 {
        return None;
    }
    let plen = u16::from_be_bytes([q[4], q[5]]);
    let proto = match q[6] {
        58 => 1,
        p @ (6 | 17) => p,
        _ => return None,
    };
    let dst4 = extract(prefix, &q[24..40])?;
    let mut rest = q[40..].to_vec();
    if proto == 1 && !rest.is_empty() {
        rest[0] = match rest[0] {
            128 => 8,
            129 => 0,
            other => other,
        };
    }
    let mut h = ipv4_header((q[0] << 4) | (q[1] >> 4), q[7], proto, src4, dst4, 20 + plen as usize)?;
    h.extend_from_slice(&rest);
    Some(h)
}

fn clamp_mss(tcp: &mut [u8]) {
    if tcp[13] & 0x02 == 0 {
        return; // not a SYN
    }
    let off = (tcp[12] >> 4) as usize * 4;
    let end = off.min(tcp.len());
    let mut i = 20;
    while i < end {
        match tcp[i] {
            0 => break,
            1 => i += 1,
            kind => {
                let Some(&len) = tcp.get(i + 1) else { break };
                let len = len as usize;
                if len < 2 || i + len > end {
                    break;
                }
                if kind == 2 && len == 4 {
                    let mss = u16::from_be_bytes([tcp[i + 2], tcp[i + 3]]);
                    if mss > MAX_MSS {
                        tcp[i + 2..i + 4].copy_from_slice(&MAX_MSS.to_be_bytes());
                    }
                }
                i += len;
            }
        }
    }
}

fn sum(data: &[u8], mut acc: u32) -> u32 {
    let mut chunks = data.chunks_exact(2);
    for c in &mut chunks {
        acc += u16::from_be_bytes([c[0], c[1]]) as u32;
    }
    if let [last] = chunks.remainder() {
        acc += (*last as u32) << 8;
    }
    acc
}

fn fold(mut acc: u32) -> u16 {
    while acc >> 16 != 0 {
        acc = (acc & 0xffff) + (acc >> 16);
    }
    !(acc as u16)
}

/// Offset of the checksum field in a TCP, UDP or ICMP header.
fn checksum_offset(proto: u8) -> usize {
    match proto {
        6 => 16,
        17 => 6,
        _ => 2, // ICMP, ICMPv6
    }
}

fn set_v6_checksum(payload: &mut [u8], next: u8, src: &Ipv6Addr, dst: &Ipv6Addr) {
    let at = checksum_offset(next);
    payload[at..at + 2].fill(0);
    let mut acc = sum(&src.octets(), 0);
    acc = sum(&dst.octets(), acc);
    acc += payload.len() as u32 + next as u32;
    let mut c = fold(sum(payload, acc));
    if next == 17 && c == 0 {
        c = 0xffff;
    }
    payload[at..at + 2].copy_from_slice(&c.to_be_bytes());
}

fn set_v4_checksum(payload: &mut [u8], proto: u8, src: Ipv4Addr, dst: Ipv4Addr) {
    let at = checksum_offset(proto);
    payload[at..at + 2].fill(0);
    let acc = if proto == 1 {
        0 // ICMPv4 has no pseudo-header
    } else {
        sum(&dst.octets(), sum(&src.octets(), 0)) + proto as u32 + payload.len() as u32
    };
    let mut c = fold(sum(payload, acc));
    if proto == 17 && c == 0 {
        c = 0xffff;
    }
    payload[at..at + 2].copy_from_slice(&c.to_be_bytes());
}

fn v6_packet(tos: u8, hlim: u8, next: u8, src: &Ipv6Addr, dst: &Ipv6Addr, payload: &[u8]) -> Vec<u8> {
    let mut p = Vec::with_capacity(40 + payload.len());
    p.extend_from_slice(&[0x60 | (tos >> 4), (tos & 0x0f) << 4, 0, 0]);
    p.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    p.extend_from_slice(&[next, hlim]);
    p.extend_from_slice(&src.octets());
    p.extend_from_slice(&dst.octets());
    p.extend_from_slice(payload);
    p
}

fn ipv4_header(tos: u8, ttl: u8, proto: u8, src: Ipv4Addr, dst: Ipv4Addr, total: usize) -> Option<Vec<u8>> {
    let total = u16::try_from(total).ok()?;
    let mut h = vec![0x45, tos];
    h.extend_from_slice(&total.to_be_bytes());
    h.extend_from_slice(&[0, 0, 0x40, 0, ttl, proto, 0, 0]); // id 0, DF
    h.extend_from_slice(&src.octets());
    h.extend_from_slice(&dst.octets());
    let c = fold(sum(&h, 0));
    h[10..12].copy_from_slice(&c.to_be_bytes());
    Some(h)
}

fn v4_packet(tos: u8, ttl: u8, proto: u8, src: Ipv4Addr, dst: Ipv4Addr, payload: &[u8]) -> Option<Vec<u8>> {
    let mut p = ipv4_header(tos, ttl, proto, src, dst, 20 + payload.len())?;
    p.extend_from_slice(payload);
    Some(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFIX: Ipv6Addr = Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0, 0);
    const CLAT6: Ipv6Addr = Ipv6Addr::new(0xfd20, 0, 1, 0, 6, 0x8000, 0, 1);

    fn v4(proto: u8, payload: &[u8], dst: [u8; 4]) -> Vec<u8> {
        v4_packet(0, 64, proto, CLAT_V4, Ipv4Addr::from(dst), payload).unwrap()
    }

    fn valid_v4_checksums(p: &[u8]) -> bool {
        let header_ok = fold(sum(&p[..20], 0)) == 0;
        let (proto, payload) = (p[9], &p[20..]);
        let acc = if proto == 1 { 0 } else { sum(&p[12..20], 0) + proto as u32 + payload.len() as u32 };
        header_ok && fold(sum(payload, acc)) == 0
    }

    fn valid_v6_checksum(p: &[u8]) -> bool {
        let payload = &p[40..];
        let acc = sum(&p[8..40], 0) + payload.len() as u32 + p[6] as u32;
        fold(sum(payload, acc)) == 0
    }

    #[test]
    fn echo_round_trip() {
        let mut echo = vec![8, 0, 0, 0, 0x12, 0x34, 0, 1, b'h', b'i'];
        let c = fold(sum(&echo, 0));
        echo[2..4].copy_from_slice(&c.to_be_bytes());
        let out = v4_to_v6(&v4(1, &echo, [1, 1, 1, 1]), CLAT6, PREFIX).unwrap();
        assert_eq!(out[6], 58);
        assert_eq!(out[40], 128);
        assert_eq!(&out[24..40], &embed(PREFIX, [1, 1, 1, 1]).octets());
        assert!(valid_v6_checksum(&out));

        // The reply, as NAT64 would deliver it.
        let mut reply = out[40..].to_vec();
        reply[0] = 129;
        let src = embed(PREFIX, [1, 1, 1, 1]);
        set_v6_checksum(&mut reply, 58, &src, &CLAT6);
        let back = v6_to_v4(&v6_packet(0, 60, 58, &src, &CLAT6, &reply), PREFIX, CLAT_V4).unwrap();
        assert_eq!(back[20], 0);
        assert_eq!(&back[12..16], &[1, 1, 1, 1]);
        assert_eq!(&back[16..20], &CLAT_V4.octets());
        assert!(valid_v4_checksums(&back));
    }

    #[test]
    fn tcp_syn_gets_mss_clamped_and_checksummed() {
        let mut syn = vec![0u8; 24];
        syn[12] = 6 << 4; // 24-byte header
        syn[13] = 0x02;
        syn[20..24].copy_from_slice(&[2, 4, 0x05, 0xb4]); // MSS 1460
        let out = v4_to_v6(&v4(6, &syn, [93, 184, 216, 34]), CLAT6, PREFIX).unwrap();
        assert_eq!(u16::from_be_bytes([out[62], out[63]]), MAX_MSS);
        assert!(valid_v6_checksum(&out));
    }

    #[test]
    fn udp_back_to_v4() {
        let src = embed(PREFIX, [8, 8, 8, 8]);
        let mut udp = vec![0, 53, 0x30, 0x39, 0, 12, 0, 0, 1, 2, 3, 4];
        set_v6_checksum(&mut udp, 17, &src, &CLAT6);
        let back = v6_to_v4(&v6_packet(0, 60, 17, &src, &CLAT6, &udp), PREFIX, CLAT_V4).unwrap();
        assert!(valid_v4_checksums(&back));
    }

    #[test]
    fn packet_too_big_becomes_frag_needed() {
        let src = embed(PREFIX, [9, 9, 9, 9]);
        let quoted = v6_packet(0, 63, 6, &CLAT6, &embed(PREFIX, [1, 1, 1, 1]), &[0u8; 20]);
        let mut ptb = vec![2, 0, 0, 0, 0, 0, 0x05, 0x00];
        ptb.extend_from_slice(&quoted);
        set_v6_checksum(&mut ptb, 58, &src, &CLAT6);
        let back = v6_to_v4(&v6_packet(0, 60, 58, &src, &CLAT6, &ptb), PREFIX, CLAT_V4).unwrap();
        assert_eq!((back[20], back[21]), (3, 4));
        assert_eq!(u16::from_be_bytes([back[26], back[27]]), 1280 - 20);
        assert_eq!(&back[28 + 16..28 + 20], &[1, 1, 1, 1]); // quoted destination
        assert!(valid_v4_checksums(&back));
    }

    #[test]
    fn fragments_and_foreign_sources_are_dropped() {
        let mut frag = v4(17, &[0u8; 8], [1, 1, 1, 1]);
        frag[6] = 0x20; // more fragments
        assert!(v4_to_v6(&frag, CLAT6, PREFIX).is_none());
        let other = Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1);
        let mut udp = vec![0u8; 8];
        set_v6_checksum(&mut udp, 17, &other, &CLAT6);
        assert!(v6_to_v4(&v6_packet(0, 60, 17, &other, &CLAT6, &udp), PREFIX, CLAT_V4).is_none());
    }
}
