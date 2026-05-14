from redis.asyncio import Redis


class RedisManager:
    def __init__(self, host: str, port: int) -> None:
        self._client = Redis(host=host, port=port, decode_responses=True)

    @property
    def client(self) -> Redis:
        return self._client

    async def ping(self) -> bool:
        return bool(await self._client.ping())

    async def disconnect(self) -> None:
        await self._client.aclose()
