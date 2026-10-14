# A small shell inside the VPC: ping, traceroute, mtr, dig, curl, nc and an ssh client, plus bash for
# netcheck (bin/jump installs it in /root). iputils (not BusyBox) because BusyBox ping needs a raw
# socket and exec sessions start without capabilities.
FROM alpine:3.20
RUN apk add --no-cache bash iputils traceroute mtr bind-tools curl openssh-client netcat-openbsd iproute2
WORKDIR /root
ENV PATH=/root:$PATH
CMD ["tail", "-f", "/dev/null"]
