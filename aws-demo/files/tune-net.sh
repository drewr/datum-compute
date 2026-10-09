#!/usr/bin/env bash
# BBR + fq: iroh carries the VPC tunnel over a TCP relay connection, and cubic bufferbloats long legs
# (Singapore to the us-east-1 gateway: 289 ms with cubic, 253 ms with BBR).
set -e
echo tcp_bbr > /etc/modules-load.d/tcp-bbr.conf
modprobe tcp_bbr
cat > /etc/sysctl.d/90-datum-tuning.conf <<'CONF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_notsent_lowat = 16384
CONF
sysctl --system >/dev/null
