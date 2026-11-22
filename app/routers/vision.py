"""Vision endpoints — customer MMS photos, item identification, damage assessment."""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from app.services import groq_service
from app.services.profile_service import load_profile
from app.models import conversation

router = APIRouter(prefix="/vision", tags=["vision"])


@router.post("/describe")
async def describe_image(
    image: UploadFile = File(...),
    prompt: str = Form("Describe what you see in this image."),
):
    """Raw image → description. No business context, general purpose."""
    image_bytes = await image.read()
    result = groq_service.describe_image(image_bytes, prompt=prompt)
    return {"description": result}


@router.post("/mms")
async def handle_mms(
    image: UploadFile = File(...),
    client: str = Form(...),
    phone: str = Form(...),
    caption: str = Form(""),
):
    """Customer sent a photo via MMS.
    Loads business profile, describes image in context, adds to conversation history,
    returns AI response as if the receptionist saw the photo.
    """
    try:
        profile = load_profile(client)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Client '{client}' not found")

    image_bytes = await image.read()

    # Describe the image with the business profile as context
    description = groq_service.describe_image_with_profile(
        image_bytes=image_bytes,
        system_prompt=profile["system_prompt"],
        customer_message=caption,
    )

    # Treat the vision output as the customer's "message" for history
    user_turn = f"[Customer sent a photo{': ' + caption if caption else ''}]\nImage content: {description}"
    conversation.append(client, phone, "user", user_turn)
    history = conversation.get_history(client, phone)

    # Let the receptionist AI respond knowing what the photo shows
    reply = groq_service.chat(
        system_prompt=profile["system_prompt"],
        history=history[:-1],
        user_message=user_turn,
    )
    conversation.append(client, phone, "assistant", reply)

    return {
        "image_description": description,
        "reply": reply,
    }
