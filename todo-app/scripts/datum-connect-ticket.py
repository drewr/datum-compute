#!/usr/bin/env python3
"""Print a datum-connect ticket for a TCP service behind a `datum-connect serve`.

    datum-connect-ticket.py ENDPOINT HOST:PORT [LABEL]

ENDPOINT is the serve side's endpoint ID (64 hex characters), or a path to its
32-byte --listen-key-file ("-" for stdin), from which the ID is derived. That
needs the `cryptography` package, e.g. in `nix-shell -p python3Packages.cryptography`.

`datum-connect serve` prints its endpoint ID ("listening as ...") but no
ticket, and `datum-connect connect` only takes a ticket. HOST:PORT must match
the serve side's --tcp-proxy value exactly, brackets included for IPv6
(`[fd20:0:1::1:0:0]:5432`); serve allows only the services it was started with.

The format follows datum-cloud/app lib/src/state.rs: "datum" + lowercase
unpadded base32 of the postcard encoding of
AdvertismentTicket { data: Advertisment { resource_id, label, data: { host, port } }, endpoint }.
"""
import base64
import re
import sys


def varint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def string(s: str) -> bytes:
    b = s.encode()
    return varint(len(b)) + b


def endpoint_id(arg: str) -> bytes:
    if re.fullmatch(r"[0-9a-fA-F]{64}", arg):
        return bytes.fromhex(arg)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    secret = sys.stdin.buffer.read() if arg == "-" else open(arg, "rb").read()
    if len(secret) != 32:
        sys.exit("the key file must hold exactly 32 bytes")
    public = Ed25519PrivateKey.from_private_bytes(secret).public_key()
    return public.public_bytes(Encoding.Raw, PublicFormat.Raw)


def main() -> None:
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: datum-connect-ticket.py ENDPOINT HOST:PORT [LABEL]")
    endpoint = endpoint_id(sys.argv[1])
    host, _, port = sys.argv[2].rpartition(":")
    label = sys.argv[3] if len(sys.argv) == 4 else None

    data = string("proxy-" + endpoint.hex()[:12])  # resource_id; serve ignores it
    data += b"\x01" + string(label) if label else b"\x00"
    data += string(host) + varint(int(port))
    data += endpoint  # [u8; 32], no length prefix

    print(f"endpoint {endpoint.hex()}", file=sys.stderr)
    print("datum" + base64.b32encode(data).decode().rstrip("=").lower())


if __name__ == "__main__":
    main()
