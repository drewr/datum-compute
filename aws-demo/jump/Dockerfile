# A small shell inside the VPC: ping, traceroute, mtr, dig, curl, nc and an ssh client. iputils (not
# BusyBox) because BusyBox ping needs a raw socket and exec sessions start without capabilities.
FROM alpine:3.20
RUN apk add --no-cache iputils traceroute mtr bind-tools curl openssh-client netcat-openbsd iproute2
CMD ["tail", "-f", "/dev/null"]
