"""Deny network access for deterministic local-provider worker tests."""

import socket


class NetworkDeniedSocket(socket.socket):
    def connect(self, *_args, **_kwargs):
        raise RuntimeError("network access denied by local transcription fixture")

    def connect_ex(self, *_args, **_kwargs):
        raise RuntimeError("network access denied by local transcription fixture")


def network_denied(*_args, **_kwargs):
    raise RuntimeError("network access denied by local transcription fixture")


socket.socket = NetworkDeniedSocket
socket.create_connection = network_denied
