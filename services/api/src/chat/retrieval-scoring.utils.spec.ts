import {
  computeJaccard,
  normalizeLexicalRank,
  normalizeSemanticDistance,
} from "./retrieval-scoring.utils";

describe("retrieval-scoring.utils", () => {
  it("normalizes semantic distance to a bounded 0..1 score", () => {
    expect(normalizeSemanticDistance(0)).toBe(1);
    expect(normalizeSemanticDistance(1)).toBe(0.5);
    expect(normalizeSemanticDistance(2)).toBe(0);
    expect(normalizeSemanticDistance(Number.NaN)).toBe(0);
  });

  it("normalizes lexical ts_rank values without exceeding 1", () => {
    expect(normalizeLexicalRank(0)).toBe(0);
    expect(normalizeLexicalRank(0.5)).toBeCloseTo(0.333333, 5);
    expect(normalizeLexicalRank(3)).toBeCloseTo(0.75, 5);
  });

  it("computes stable jaccard overlap for near-duplicate detection", () => {
    expect(
      computeJaccard(
        "reset the worker before retrying the failed job",
        "reset worker before retrying failed job now",
      ),
    ).toBeGreaterThan(0.7);
    expect(
      computeJaccard("worker retry playbook", "vacation policy handbook"),
    ).toBe(0);
  });
});
