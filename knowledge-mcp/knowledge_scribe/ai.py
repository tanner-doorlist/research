"""
Lazy singleton AI clients for Claude and OpenAI.

Import these instead of creating clients at module level in each file.
Clients are created on first access so that importing the module doesn't
fail when API keys are not yet set.
"""

_anthropic_client = None
_openai_client = None


def _get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import Anthropic
        _anthropic_client = Anthropic()
    return _anthropic_client


def _get_openai():
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        _openai_client = OpenAI()
    return _openai_client


class _LazyClient:
    """Descriptor that lazily initializes an AI client on first attribute access."""

    def __init__(self, factory):
        self._factory = factory

    def __getattr__(self, name):
        client = self._factory()
        return getattr(client, name)


anthropic_client = _LazyClient(_get_anthropic)
openai_client = _LazyClient(_get_openai)
