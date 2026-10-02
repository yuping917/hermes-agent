"""Fork LINE contracts, exercising the real adapter/cache with only HTTP and handler mocked."""
import asyncio
import json
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from gateway.config import PlatformConfig
from tests.gateway._plugin_adapter_loader import load_plugin_adapter

line = load_plugin_adapter("line")


@pytest.fixture
def adapter(monkeypatch):
    for name in ("LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"):
        monkeypatch.delenv(name, raising=False)
    ad = line.LineAdapter(PlatformConfig(enabled=True, extra={
        "channel_access_token": "test-token", "channel_secret": "test-secret",
        "allowed_users": ["Utest"], "allowed_groups": ["Ctest"],
        "allowed_rooms": ["Rtest"],
    }))
    ad._client = MagicMock()
    for method in ("reply", "push", "loading", "fetch_content"):
        setattr(ad._client, method, AsyncMock())
    ad.handle_message = AsyncMock()
    return ad


def event(kind="group", text="hello", msg_type="text", mention=None):
    source = {"type": kind, "userId": "Utest"}
    if kind != "user":
        source[kind + "Id"] = "Ctest" if kind == "group" else "Rtest"
    message = {"type": msg_type, "id": "message-1", "text": text}
    if mention is not None:
        message["mention"] = {"mentionees": mention}
    return {"type": "message", "replyToken": "new-token", "source": source, "message": message}


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["group", "room"])
@pytest.mark.parametrize("text,mention", [
    ("hello", None), ("please @hermes answer", None), ("@hermesbot hello", None),
    ("hello", [{"isSelf": False, "type": "user"}]),
])
async def test_unmentioned_text_rejected_without_overwriting_token(adapter, kind, text, mention):
    chat = "Ctest" if kind == "group" else "Rtest"
    original = ("in-flight-token", time.time() + 60)
    adapter._reply_tokens[chat] = original
    await adapter._dispatch_event(event(kind, text, mention=mention))
    adapter.handle_message.assert_not_awaited()
    assert adapter._reply_tokens[chat] == original


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["group", "room"])
@pytest.mark.parametrize("msg_type", ["image", "audio", "video", "file", "sticker", "location"])
async def test_group_nontext_rejected_before_token_or_download(adapter, kind, msg_type):
    chat = "Ctest" if kind == "group" else "Rtest"
    original = ("in-flight-token", time.time() + 60)
    adapter._reply_tokens[chat] = original
    await adapter._dispatch_event(event(kind, "@hermes", msg_type, [{"isSelf": True}]))
    adapter.handle_message.assert_not_awaited()
    adapter._client.fetch_content.assert_not_awaited()
    assert adapter._reply_tokens[chat] == original


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["group", "room"])
@pytest.mark.parametrize("text,mention", [
    ("@hermes hello", None), ("  ＠HeRmEs hello  ", None), ("@ HERMES hello", None),
    ("hello bot", [{"isSelf": True}]), ("hello all", [{"type": "all"}]),
])
async def test_mentions_accepted_and_original_text_preserved(adapter, kind, text, mention):
    await adapter._dispatch_event(event(kind, text, mention=mention))
    adapter.handle_message.assert_awaited_once()
    assert adapter.handle_message.await_args.args[0].text == text
    chat = "Ctest" if kind == "group" else "Rtest"
    assert adapter._reply_tokens[chat][0] == "new-token"


@pytest.mark.asyncio
async def test_dm_bypasses_mention_gate(adapter):
    await adapter._dispatch_event(event("user"))
    adapter.handle_message.assert_awaited_once()
    assert adapter.handle_message.await_args.args[0].text == "hello"
    assert adapter._reply_tokens["Utest"][0] == "new-token"


async def slow_button(adapter):
    """Fire the actual threshold/typing workflow, not a mocked cache transition."""
    adapter.slow_response_threshold = 0.001
    adapter._reply_tokens["Utest"] = ("original-token", time.time() + 60)
    fired = asyncio.Event()

    async def button_reply(token, messages):
        assert token == "original-token"
        assert messages[0]["type"] == "template"
        fired.set()

    adapter._client.reply.side_effect = button_reply
    stop = asyncio.Event()
    task = asyncio.create_task(adapter._keep_typing("Utest", interval=0.01, stop_event=stop))
    try:
        await asyncio.wait_for(fired.wait(), timeout=2)
    finally:
        stop.set()
        await asyncio.wait_for(task, timeout=2)
    adapter._client.reply.side_effect = None
    rid = adapter._pending_buttons["Utest"]
    assert adapter._cache.get(rid).state is line.State.PENDING
    assert "Utest" not in adapter._reply_tokens
    adapter._client.reply.reset_mock()
    return rid


def postback(rid):
    return {"type": "postback", "replyToken": "fresh-token",
            "source": {"type": "user", "userId": "Utest"},
            "postback": {"data": json.dumps({"action": "show_response", "request_id": rid})}}


@pytest.mark.asyncio
async def test_slow_final_auto_push_settles_cache_and_tap_does_not_redeliver(adapter):
    rid = await slow_button(adapter)
    result = await adapter.send("Utest", "Final answer")
    assert result.success
    adapter._client.push.assert_awaited_once_with("Utest", [{"type": "text", "text": "Final answer"}])
    assert adapter._cache.get(rid).state is line.State.DELIVERED
    assert "Utest" not in adapter._pending_buttons
    await adapter._dispatch_event(postback(rid))
    assert adapter._client.reply.await_args.args[1][0]["text"] == adapter.delivered_text
    assert adapter._client.push.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("reply_fails", [False, True])
async def test_failed_auto_push_retains_ready_for_button_reply_or_push_fallback(adapter, reply_fails):
    rid = await slow_button(adapter)
    adapter._client.push.side_effect = RuntimeError("push unavailable")
    result = await adapter.send("Utest", "Final answer")
    assert adapter._client.push.await_count == 1, "final must attempt automatic push"
    assert result.success, "cached answer remains retrievable despite failed push"
    assert adapter._cache.get(rid).state is line.State.READY
    assert adapter._pending_buttons["Utest"] == rid
    adapter._client.push.side_effect = None
    if reply_fails:
        adapter._client.reply.side_effect = RuntimeError("reply rejected")
    await adapter._dispatch_event(postback(rid))
    adapter._client.reply.assert_awaited_once_with("fresh-token", [{"type": "text", "text": "Final answer"}])
    assert adapter._client.push.await_count == (2 if reply_fails else 1)
    assert adapter._cache.get(rid).state is line.State.DELIVERED
    assert "Utest" not in adapter._pending_buttons


@pytest.mark.asyncio
async def test_interim_does_not_pollute_final_auto_push(adapter):
    rid = await slow_button(adapter)
    await adapter.send("Utest", "research progress", metadata={"_interim_send": True})
    assert adapter._cache.get(rid).state is line.State.PENDING
    assert adapter._pending_buttons["Utest"] == rid
    await adapter.send("Utest", "Final answer")
    assert adapter._cache.get(rid).payload == "Final answer"
    assert adapter._cache.get(rid).state is line.State.DELIVERED
    assert [c.args[1][0]["text"] for c in adapter._client.push.await_args_list] == ["research progress", "Final answer"]


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["ready", "delivered", "error", "missing"])
async def test_stale_mapping_never_swallows_new_final(adapter, state):
    rid = adapter._cache.register_pending("Utest")
    if state == "ready" or state == "delivered":
        adapter._cache.set_ready(rid, "old")
    if state == "delivered":
        adapter._cache.mark_delivered(rid)
    if state == "error":
        adapter._cache.set_error(rid, "old error")
    adapter._pending_buttons["Utest"] = "missing" if state == "missing" else rid
    assert (await adapter.send("Utest", "new final")).success
    adapter._client.push.assert_awaited_once_with("Utest", [{"type": "text", "text": "new final"}])
    assert "Utest" not in adapter._pending_buttons


@pytest.mark.asyncio
@pytest.mark.parametrize("reject_reply", [False, True])
async def test_normal_response_prefers_valid_reply_token(adapter, reject_reply):
    await adapter._dispatch_event(event("user"))
    adapter._client.reply.side_effect = RuntimeError("reply rejected") if reject_reply else None
    assert (await adapter.send("Utest", "normal final")).success
    adapter._client.reply.assert_awaited_once_with("new-token", [{"type": "text", "text": "normal final"}])
    assert adapter._client.push.await_count == int(reject_reply)
    assert "Utest" not in adapter._reply_tokens
