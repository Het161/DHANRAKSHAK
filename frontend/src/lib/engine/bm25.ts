/**
 * Port of rank_bm25.BM25Okapi (the defaults the server's AdvisoryRetriever uses:
 * k1=1.5, b=0.75, epsilon=0.25), including its negative-idf epsilon correction.
 * The corpus is a handful of advisory chunks, so the index is built at load.
 */

const K1 = 1.5;
const B = 0.75;
const EPSILON = 0.25;

export class BM25Okapi {
  private readonly corpusSize: number;
  private readonly avgdl: number;
  private readonly docLen: number[];
  private readonly docFreqs: Map<string, number>[];
  private readonly idf = new Map<string, number>();

  constructor(corpus: string[][]) {
    this.corpusSize = corpus.length;
    this.docLen = corpus.map((doc) => doc.length);
    this.avgdl = this.corpusSize > 0 ? this.docLen.reduce((a, b) => a + b, 0) / this.corpusSize : 0;

    const nd = new Map<string, number>();
    this.docFreqs = corpus.map((doc) => {
      const freqs = new Map<string, number>();
      for (const word of doc) freqs.set(word, (freqs.get(word) ?? 0) + 1);
      for (const word of freqs.keys()) nd.set(word, (nd.get(word) ?? 0) + 1);
      return freqs;
    });
    this.calcIdf(nd);
  }

  private calcIdf(nd: Map<string, number>): void {
    let idfSum = 0;
    const negatives: string[] = [];
    for (const [word, freq] of nd) {
      const idf = Math.log(this.corpusSize - freq + 0.5) - Math.log(freq + 0.5);
      this.idf.set(word, idf);
      idfSum += idf;
      if (idf < 0) negatives.push(word);
    }
    const averageIdf = this.idf.size > 0 ? idfSum / this.idf.size : 0;
    const eps = EPSILON * averageIdf;
    for (const word of negatives) this.idf.set(word, eps);
  }

  getScores(query: string[]): number[] {
    const scores = new Array(this.corpusSize).fill(0);
    for (const q of query) {
      const idf = this.idf.get(q) ?? 0;
      for (let i = 0; i < this.corpusSize; i += 1) {
        const freq = this.docFreqs[i]!.get(q) ?? 0;
        const denom = freq + K1 * (1 - B + (B * this.docLen[i]!) / this.avgdl);
        scores[i] += (idf * (freq * (K1 + 1))) / denom;
      }
    }
    return scores;
  }
}
