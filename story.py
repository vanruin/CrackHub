# story.py
import asyncio
import json
import sys
from typing import Optional, Dict, Any, List

import aiohttp


class StoryGenerator:
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        config = config or {}
        self.config = {
            "apiKey": config.get("apiKey") or "1234Test",
            "baseUrl": config.get("baseUrl") or "https://responsedh.mycdnpro.com",
            "endpoint": "/api/Text/Generate",
            "timeout": config.get("timeout") or 30,
            "client": config.get("client") or "StoryApp",
        }
        self.config.update(config)
        print("StoryGenerator initialized")
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    # ---------- main dispatcher ----------
    async def gen(
        self,
        type: str = "quick",
        text: Optional[str] = None,
        client: Optional[str] = None,
        mode: str = "Any genre",
        length: str = "Short",
        creative: str = "Medium",
        language: Optional[str] = None,
        syllable: Optional[str] = None,
        **rest,
    ) -> Dict[str, Any]:
        client = client or self.config["client"]
        try:
            print(f"Generating story with type: {type}")

            if not text:
                return {"success": False, "result": None,
                        "error": "Text parameter is required"}

            valid_types = ["quick", "advanced", "text"]
            if type not in valid_types:
                return {"success": False, "result": None,
                        "error": f"Invalid type. Must be one of: {', '.join(valid_types)}"}

            if type == "quick":
                api_result = await self.quick_gen(text=text, client=client, **rest)
            elif type == "advanced":
                api_result = await self.advanced_gen(
                    text=text, client=client, mode=mode, length=length,
                    creative=creative, language=language, syllable=syllable, **rest
                )
            elif type == "text":
                api_result = await self.gen_text(text=text, client=client, **rest)
            else:
                api_result = await self.quick_gen(text=text, client=client, **rest)

            if isinstance(api_result, dict) and "success" in api_result:
                return api_result
            return {"success": True, "result": api_result}

        except Exception as error:
            print(f"Story generation failed for type {type}: {error}")
            return {"success": False, "result": None, "error": str(error)}

    # ---------- quick ----------
    async def quick_gen(self, text: Optional[str] = None,
                        client: Optional[str] = None, **rest) -> Dict[str, Any]:
        client = client or self.config["client"]
        try:
            print("Quick story generation...")
            if not text:
                return {"success": False, "result": None,
                        "error": "Text parameter is required for quick generation"}

            user_agent = rest.pop("userAgent", None) or "Dart/3.8 (dart:io)"
            headers_extra = rest.pop("headers", None) or {}
            timeout = rest.pop("timeout", None) or self.config["timeout"]

            request_body = {
                "text": text,
                "client": client,
                "toolName": "_storygenerator",
                "mode": "Any genre",
                "length": "Short",
                "creative": "Medium",
                "language": None,
                "syllable": None,
                **rest,
            }

            headers = {
                "User-Agent": user_agent,
                "Content-Type": "application/json",
                "dhp-api-key": self.config["apiKey"],
                **headers_extra,
            }

            session = await self._get_session()
            url = f"{self.config['baseUrl']}{self.config['endpoint']}"

            async with session.post(
                url, json=request_body, headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                data = await resp.json(content_type=None)

            if not data.get("isSuccess"):
                error_messages: List[str] = data.get("errorMessages") or []
                error_msg = ", ".join(error_messages) if error_messages else "Unknown API error"
                return {"success": False, "result": None,
                        "error": f"API error: {error_msg}"}

            print("Quick story generation successful")
            return {"success": True, "result": data.get("response")}

        except Exception as error:
            print(f"Quick generation failed: {error}")
            return {"success": False, "result": None, "error": str(error)}

    # ---------- advanced ----------
    async def advanced_gen(
        self,
        text: Optional[str] = None,
        client: Optional[str] = None,
        mode: str = "Any genre",
        length: str = "Short",
        creative: str = "Medium",
        language: Optional[str] = None,
        syllable: Optional[str] = None,
        **rest,
    ) -> Dict[str, Any]:
        client = client or self.config["client"]
        try:
            print("Advanced story generation...")
            if not text:
                return {"success": False, "result": None,
                        "error": "Text parameter is required"}

            valid_modes = [
                "Any genre", "Action", "Sci-fi", "Mystery", "Biography",
                "Young Adult", "Crime", "Horror", "Thriller",
                "Children Books", "Non-fiction", "Humor", "Historical Fiction",
            ]
            valid_lengths = ["Short", "Novel"]
            valid_creative = ["Medium", "High"]

            if mode not in valid_modes:
                return {"success": False, "result": None,
                        "error": f"Invalid mode. Must be one of: {', '.join(valid_modes)}"}
            if length not in valid_lengths:
                return {"success": False, "result": None,
                        "error": f"Invalid length. Must be one of: {', '.join(valid_lengths)}"}
            if creative not in valid_creative:
                return {"success": False, "result": None,
                        "error": f"Invalid creative level. Must be one of: {', '.join(valid_creative)}"}

            user_agent = rest.pop("userAgent", None) or "Dart/3.8 (dart:io)"
            headers_extra = rest.pop("headers", None) or {}
            timeout = rest.pop("timeout", None) or self.config["timeout"]

            request_body = {
                "text": text,
                "client": client,
                "toolName": "_storygenerator",
                "mode": mode,
                "length": length,
                "language": language,
                "syllable": syllable,
                "creative": creative,
                **rest,
            }

            print("Sending advanced story request...")
            headers = {
                "User-Agent": user_agent,
                "Content-Type": "application/json",
                "dhp-api-key": self.config["apiKey"],
                **headers_extra,
            }

            session = await self._get_session()
            url = f"{self.config['baseUrl']}{self.config['endpoint']}"

            async with session.post(
                url, json=request_body, headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                data = await resp.json(content_type=None)

            if not data.get("isSuccess"):
                error_messages: List[str] = data.get("errorMessages") or []
                error_msg = ", ".join(error_messages) if error_messages else "Unknown API error"
                return {"success": False, "result": None,
                        "error": f"API error: {error_msg}"}

            print("Advanced story generation successful")
            return {"success": True, "result": data.get("response")}

        except Exception as error:
            print(f"Advanced generation failed: {error}")
            return {"success": False, "result": None, "error": str(error)}

    # ---------- text extraction ----------
    async def gen_text(self, text: Optional[str] = None,
                       client: Optional[str] = None, **rest) -> Dict[str, Any]:
        client = client or self.config["client"]
        try:
            print("Extracting story text...")
            response = await self.quick_gen(text=text, client=client, **rest)

            if not response.get("success"):
                return {"success": False, "result": None,
                        "error": response.get("error")}

            story_text = response.get("result")
            if not story_text:
                return {"success": False, "result": None,
                        "error": "No story text found in response"}

            print("Text extraction successful")
            return {"success": True, "result": story_text}

        except Exception as error:
            print(f"Text extraction failed: {error}")
            return {"success": False, "result": None, "error": str(error)}


# ---------- handler (equivalent to JS handler(req,res)) ----------

async def run_handler(params: Dict[str, Any]) -> Dict[str, Any]:
    if not params.get("text"):
        return {"error": "Text are required"}

    api = StoryGenerator()
    try:
        return await api.gen(**params)
    except Exception as error:
        return {"error": str(error) or "Internal Server Error"}
    finally:
        await api.close()


# ---------- CLI ----------

def _usage():
    print("""Usage:
  python story.py quick "<prompt>"
  python story.py advanced "<prompt>" [Mode] [Length] [Creative]
  python story.py text "<prompt>"

Modes:
  Any genre, Action, Sci-fi, Mystery, Biography, Young Adult,
  Crime, Horror, Thriller, Children Books, Non-fiction,
  Humor, Historical Fiction

Length:   Short | Novel
Creative: Medium | High

Examples:
  python story.py quick "a lighthouse keeper finds a message from 100 years ago"
  python story.py advanced "a detective who can only lie" Mystery Short High
  python story.py advanced "a rebellion in cyberpunk Manila" Sci-fi Novel High
  python story.py text "a boy who can hear colors"
""")


async def _cli():
    args = sys.argv[1:]

    if not args:
        _usage()
        return

    kind = args[0].lower()

    if kind not in ("quick", "advanced", "text"):
        _usage()
        return

    prompt = args[1] if len(args) > 1 else ""
    if not prompt:
        print("Error: missing prompt.\n")
        _usage()
        return

    params: Dict[str, Any] = {"text": prompt, "type": kind}

    if kind == "advanced":
        params["mode"] = args[2] if len(args) > 2 else "Any genre"
        params["length"] = args[3] if len(args) > 3 else "Short"
        params["creative"] = args[4] if len(args) > 4 else "Medium"

    result = await run_handler(params)

    print("\n" + "=" * 70)
    if result.get("success"):
        story = result["result"]
        print(story)
        print("=" * 70)
        try:
            with open("story.txt", "w", encoding="utf-8") as f:
                f.write(story)
            print("\n[Saved to story.txt]")
        except Exception as e:
            print(f"\n[Could not save to story.txt: {e}]")
    else:
        print("ERROR:", result.get("error"))
        print("=" * 70)


if __name__ == "__main__":
    asyncio.run(_cli())