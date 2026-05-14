import math

import tiktoken


class TokenCounter:
    def __init__(self) -> None:
        try:
            self._encoding = tiktoken.get_encoding("cl100k_base")
            self.encoding_name = "cl100k_base"
        except Exception:
            self._encoding = None
            self.encoding_name = "char_approx"

    def count(self, text: str) -> int:
        if not text:
            return 0
        if self._encoding is not None:
            return len(self._encoding.encode(text))
        return max(1, math.ceil(len(text) / 4))
