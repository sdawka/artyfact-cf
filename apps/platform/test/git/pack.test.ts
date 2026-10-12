import { describe, expect, it } from "vitest";
import { encodeBlob, encodeCommit, encodeTree, hashObject } from "../../worker/git/objects";
import { buildPack, objectHeader } from "../../worker/git/pack";
import { FLUSH, demuxSideband, parsePkts, pkt, pktText } from "../../worker/git/pkt-line";
import { parsePack } from "../helpers/fake-receive-pack";

const dec = new TextDecoder();

describe("pack", () => {
  it("encodes object headers as type + base-128 size", () => {
    expect([...objectHeader("blob", 6)]).toEqual([0x36]);
    expect([...objectHeader("commit", 15)]).toEqual([0x1f]);
    expect([...objectHeader("tree", 16)]).toEqual([0xa0, 0x01]);
    expect([...objectHeader("blob", 1_000_000)]).toEqual([0xb0, 0xa4, 0xe8, 0x03]);
  });

  it("round-trips through a node:zlib reader with a valid trailer", async () => {
    const big = "line\n".repeat(50_000);
    const objs = [encodeBlob("hello\n"), encodeBlob(big), encodeBlob("")];
    const tree = encodeTree([{ name: "a", hash: await hashObject(objs[0]), type: "blob" }]);
    const commit = encodeCommit({ tree: await hashObject(tree), parents: [], author: { name: "a", email: "a@b", at: 1 }, message: "m" });
    const pack = await buildPack([...objs, tree, commit]);
    expect(dec.decode(pack.subarray(0, 4))).toBe("PACK");
    const back = await parsePack(pack);
    expect(back.map((o) => o.type)).toEqual(["blob", "blob", "blob", "tree", "commit"]);
    expect(await Promise.all(back.map(hashObject))).toEqual(await Promise.all([...objs, tree, commit].map(hashObject)));
    const corrupt = pack.slice();
    corrupt[20] ^= 0xff;
    await expect(parsePack(corrupt)).rejects.toThrow(/checksum/);
  });
});

describe("pkt-line", () => {
  it("frames payloads with a 4-hex length and parses them back", () => {
    expect(dec.decode(pkt("a\n"))).toBe("0006a\n");
    expect(dec.decode(FLUSH)).toBe("0000");
    const stream = new Uint8Array([...pkt("one\n"), ...FLUSH, ...pkt("two"), ...new TextEncoder().encode("PACKxyz")]);
    const { pkts, rest } = parsePkts(stream);
    expect(pkts.map((p) => (p ? pktText(p) : null))).toEqual(["one", null, "two"]);
    expect(dec.decode(rest)).toBe("PACKxyz");
    expect(() => pkt(new Uint8Array(70_000))).toThrow(/exceeds/);
  });

  it("demultiplexes side-band channels", () => {
    const band = (ch: number, s: string) => pkt(new Uint8Array([ch, ...new TextEncoder().encode(s)]));
    const { pkts } = parsePkts(new Uint8Array([...band(1, "000eunpack ok\n"), ...band(2, "Resolving\n"), ...band(3, "boom"), ...FLUSH]));
    const out = demuxSideband(pkts);
    expect(dec.decode(out.data)).toBe("000eunpack ok\n");
    expect(out.progress).toBe("Resolving\n");
    expect(out.error).toBe("boom");
  });
});
