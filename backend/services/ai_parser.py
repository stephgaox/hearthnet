import base64
import json
import os
import re


class AIUnavailableError(Exception):
    """Raised when AI parsing is requested but no API key or SDK is available."""
    pass


_client = None


def is_ai_available() -> bool:
    """Check whether AI parsing can be used (SDK installed + key configured)."""
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    return bool(key) and key != "your_anthropic_api_key_here"


def _get_client():
    """Lazy-initialize the Anthropic client. Raises AIUnavailableError if unavailable."""
    global _client
    if _client is not None:
        return _client

    try:
        from anthropic import Anthropic
    except ImportError:
        raise AIUnavailableError(
            "The Anthropic Python SDK is not installed. "
            "To enable AI parsing, run: pip install anthropic"
        )

    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key or key == "your_anthropic_api_key_here":
        raise AIUnavailableError(
            "No Anthropic API key configured. "
            "To enable AI parsing for scanned PDFs and images, "
            "add ANTHROPIC_API_KEY to your .env file. "
            "Get a key at https://console.anthropic.com/"
        )

    _client = Anthropic(api_key=key)
    return _client

CATEGORIES = [
    "Food & Dining",
    "Groceries",
    "Kids & Childcare",
    "Car",
    "Entertainment",
    "Shopping",
    "Home",
    "Subscriptions",
    "Medical",
    "Education",
    "Travel",
    "Pet",
    "Bills & Utilities",
    "Income",
    "Refund",
    "Other",
    "Transfer",          # bank↔bank or bank→investment (generic)
    "CC Payments",       # bank paying a CC bill (transfer_out on bank side)
    "Payment Received",  # CC statement: payment received from cardholder (transfer_in on CC side)
]

SYSTEM_PROMPT = (
    "You are a financial transaction extractor. Extract all transactions from the provided "
    "bank or credit card statement.\n\n"
    "Return a JSON array where each item has:\n"
    "- date: string in ISO format YYYY-MM-DD\n"
    "- description: merchant or transaction description\n"
    "- amount: positive number (all transactions as positive, use type to indicate direction)\n"
    "- type: 'expense' for purchases/charges/debits, 'income' for deposits/credits received, "
    "'transfer_out' for money leaving an account (transfers, CC bill payments from bank), "
    "'transfer_in' for money arriving into an account (payment received at CC, incoming transfers)\n"
    "- category: one of the allowed categories below\n\n"
    "Allowed categories: " + ", ".join(CATEGORIES) + "\n\n"
    "Rules:\n"
    "- Bank paying a CC bill ('AutoPay', 'EPay', 'EPAYMENT', 'Card Srvc Payment', etc. on bank statement): "
    "type='transfer_out', category='CC Payments'\n"
    "- CC statement receiving a payment ('Payment Thank You', 'Mobile Payment', 'Payment Received'): "
    "type='transfer_in', category='Payment Received'\n"
    "- Transfers between own bank accounts or to investment accounts (outgoing): "
    "type='transfer_out', category='Transfer'\n"
    "- Transfers between own bank accounts (incoming): "
    "type='transfer_in', category='Transfer'\n"
    "- Refunds/returns: type='income', amount=positive, category='Refund'\n"
    "- Salary, payroll, direct deposit: type='income', category='Income'\n"
    "- Only return the JSON array, no markdown, no explanation."
)


def _parse_response(text: str) -> list[dict]:
    text = text.strip()
    # Strip markdown code blocks
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3].strip()
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "transactions" in data:
            return data["transactions"]
        return []
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return []


def parse_image(file_path: str, media_type: str) -> list[dict]:
    with open(file_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    response = _get_client().messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=8096,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": "Extract all transactions from this bank or credit card statement screenshot.",
                    },
                ],
            }
        ],
    )
    return _parse_response(response.content[0].text)


def parse_pdf(file_path: str) -> list[dict]:
    try:
        import pdfplumber

        text_content = ""
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                text_content += page.extract_text() or ""
                text_content += "\n"
    except Exception as e:
        raise ValueError(f"Could not extract text from PDF: {e}")

    # Chunk by character limit so long statements don't silently lose pages.
    # 28 000 chars ≈ 10–12 dense statement pages; well within Haiku's context window.
    CHUNK_CHARS = 28_000
    chunks = [text_content[i: i + CHUNK_CHARS] for i in range(0, len(text_content), CHUNK_CHARS)] or [""]

    all_transactions: list[dict] = []
    for chunk in chunks:
        response = _get_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8096,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"Extract all transactions from this bank statement:\n\n{chunk}",
                }
            ],
        )
        all_transactions.extend(_parse_response(response.content[0].text))
    return all_transactions


def parse_csv(file_path: str) -> list[dict]:
    with open(file_path, "r", encoding="utf-8-sig", errors="replace") as f:
        content = f.read()

    # Split large CSVs into 150-row chunks — small enough that no chunk
    # exceeds the API character limit without requiring a secondary slice.
    lines = content.splitlines()
    header = lines[0] if lines else ""
    data_lines = lines[1:]
    CHUNK = 150

    if len(data_lines) <= CHUNK:
        chunks = [content]
    else:
        chunks = []
        for i in range(0, len(data_lines), CHUNK):
            chunk_lines = [header] + data_lines[i : i + CHUNK]
            chunks.append("\n".join(chunk_lines))

    all_transactions: list[dict] = []
    for chunk in chunks:
        response = _get_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8096,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"Extract all transactions from this CSV bank/credit card statement:\n\n{chunk}",
                }
            ],
        )
        all_transactions.extend(_parse_response(response.content[0].text))

    return all_transactions


def parse_file(file_path: str, content_type: str) -> list[dict]:
    ct = content_type.lower()
    ext = os.path.splitext(file_path)[1].lower()

    if ct in ("image/jpeg", "image/png", "image/gif", "image/webp") or ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        # Normalise content type for images detected by extension
        media_type = ct if ct.startswith("image/") else f"image/{ext.lstrip('.')}"
        return parse_image(file_path, media_type)
    elif ct == "application/pdf" or ext == ".pdf":
        return parse_pdf(file_path)
    else:
        # CSV / text / octet-stream / unknown → try CSV path
        return parse_csv(file_path)
