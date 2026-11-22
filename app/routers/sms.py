"""SMS webhook — receives incoming texts, replies via Groq AI."""

from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import PlainTextResponse

from app.services import groq_service
from app.services.profile_service import load_profile
from app.models import conversation

router = APIRouter(prefix="/sms", tags=["sms"])


@router.post("/webhook", response_class=PlainTextResponse)
async def sms_webhook(
    client: str = Form(...),   # e.g. "coastal-hvac"
    From: str = Form(...),     # caller's phone number
    Body: str = Form(...),     # their message
):
    """
    Accepts Twilio-style form POST. Can also be called by Termux:API scripts.
    Returns the reply as plain text (Twilio TwiML wrapper optional — see /sms/twiml).
    """
    try:
        profile = load_profile(client)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Client '{client}' not found")

    phone = From.strip()
    user_message = Body.strip()

    # Save incoming message to history
    conversation.append(client, phone, "user", user_message)

    # Get AI reply
    history = conversation.get_history(client, phone)
    # history includes the message we just appended; pass everything except the last item as history
    reply = groq_service.chat(
        system_prompt=profile["system_prompt"],
        history=history[:-1],       # prior turns
        user_message=user_message,
    )

    # Save reply to history
    conversation.append(client, phone, "assistant", reply)

    return reply


@router.post("/twiml", response_class=PlainTextResponse)
async def sms_twiml(
    client: str = Form(...),
    From: str = Form(...),
    Body: str = Form(...),
):
    """Same as /webhook but wraps reply in Twilio TwiML <Response><Message>."""
    reply = await sms_webhook(client=client, From=From, Body=Body)
    return f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>{reply}</Message></Response>'


@router.delete("/history/{client}/{phone}")
async def clear_history(client: str, phone: str):
    conversation.clear(client, phone)
    return {"cleared": True}
