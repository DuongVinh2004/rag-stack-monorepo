import { QueryNormalizerService } from "./query-normalizer.service";

describe("QueryNormalizerService", () => {
  it("preserves quoted phrases while normalizing tokens and whitespace", () => {
    const service = new QueryNormalizerService();

    const normalized = service.preprocess(
      '  "Request ID"   escalation   steps  ',
    );

    expect(normalized.normalizedText).toBe('"request id" escalation steps');
    expect(normalized.lexicalText).toBe('"request id" escalation steps');
    expect(normalized.phrases).toEqual(["request id"]);
    expect(normalized.tokens).toEqual(["request", "id", "escalation", "steps"]);
  });

  it("drops stop words from lexical text while keeping the normalized query intact", () => {
    const service = new QueryNormalizerService();

    const normalized = service.preprocess("How do I reset the worker?");

    expect(normalized.normalizedText).toBe("how do i reset the worker");
    expect(normalized.lexicalText).toBe("reset worker");
    expect(normalized.tokens).toEqual(["reset", "worker"]);
  });

  it("detects explicit freshness intent deterministically", () => {
    const service = new QueryNormalizerService();

    const normalized = service.preprocess("latest retry policy");

    expect(normalized.freshnessIntent).toBe(true);
  });
});
