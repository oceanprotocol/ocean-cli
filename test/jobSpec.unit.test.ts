import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import { ethers } from "ethers";
import {
  validateComputeSpec,
  validateServiceSpec,
  computeSpecToInputs,
  serviceSpecToInputs,
  readJsonSpecFile,
  loadComputeSpec,
  loadServiceSpec,
  formatSpecErrors,
  expandHome,
  SpecError,
} from "../src/jobSpec.js";
import { parseComputeInput } from "../src/helpers.js";

const ADDR = "0x0000000000000000000000000000000000000001";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const paths = (r: { errors: SpecError[] }) => r.errors.map((e) => e.path);
const msgOf = (r: { errors: SpecError[] }, p: string) =>
  r.errors.find((e) => e.path === p)?.message ?? "";

const validPaid = (extra: Raw = {}): Raw => ({
  datasets: ["did:op:a"],
  algorithm: "did:op:b",
  maxJobDuration: 900,
  paymentToken: ADDR,
  resources: [],
  ...extra,
});

describe("jobSpec", function () {
  let tmpDir: string;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocean-cli-jobspec-"));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("validateComputeSpec (paid)", () => {
    const v = (raw: Raw) => validateComputeSpec(raw, { free: false });

    it("1 accepts a minimal valid spec", () => {
      const r = v(validPaid());
      expect(r.errors).to.deep.equal([]);
      expect(r.value!.datasets).to.deep.equal(["did:op:a"]);
      expect(r.value!.env).to.equal(undefined);
    });

    it("2 accepts a full valid spec with $schema", () => {
      const r = v({
        $schema: "x",
        datasets: [
          "did:op:a",
          {
            fileObject: { type: "url", url: "https://e.com/d", method: "GET" },
          },
        ],
        algorithm: "did:op:b",
        env: "0xenv",
        maxJobDuration: 3600,
        paymentToken: ADDR,
        resources: [{ id: "cpu", amount: 3 }],
        chainId: 8453,
        output: { remoteStorage: { type: "s3" } },
        serviceIds: ["svc", null],
        algoServiceId: "algosvc",
        subsidyProviders: [ADDR],
        accept: true,
      });
      expect(r.errors).to.deep.equal([]);
    });

    it("3 reports every missing required key at once", () => {
      const r = v({});
      expect(paths(r)).to.include.members([
        "datasets",
        "algorithm",
        "maxJobDuration",
        "paymentToken",
        "resources",
      ]);
    });

    it("4 datasets must be an array", () => {
      const r = v(validPaid({ datasets: "did:op:a" }));
      expect(paths(r)).to.include("datasets");
      expect(msgOf(r, "datasets")).to.contain("must be an array");
    });

    it("5 raw dataset needs fileObject", () => {
      expect(paths(v(validPaid({ datasets: [{}] })))).to.include(
        "datasets[0].fileObject",
      );
    });

    it("6 dataset entry of wrong type", () => {
      expect(paths(v(validPaid({ datasets: [5] })))).to.include("datasets[0]");
    });

    it("7 empty datasets are fine", () => {
      expect(v(validPaid({ datasets: [] })).errors).to.deep.equal([]);
    });

    it("8 raw algorithm with meta.rawcode", () => {
      const r = v(validPaid({ algorithm: { meta: { rawcode: "print(1)" } } }));
      expect(r.errors).to.deep.equal([]);
    });

    it("9 raw algorithm without fileObject or rawcode", () => {
      expect(paths(v(validPaid({ algorithm: { meta: {} } })))).to.include(
        "algorithm",
      );
    });

    for (const bad of [0, -5, 1.5, "900"]) {
      it(`10 maxJobDuration ${JSON.stringify(bad)} is rejected`, () => {
        expect(paths(v(validPaid({ maxJobDuration: bad })))).to.include(
          "maxJobDuration",
        );
      });
    }

    it("11 invalid paymentToken", () => {
      expect(paths(v(validPaid({ paymentToken: "0x123" })))).to.include(
        "paymentToken",
      );
    });

    it("12 resource amount wrong type", () => {
      const r = v(validPaid({ resources: [{ id: "cpu", amount: "1" }] }));
      expect(paths(r)).to.include("resources[0].amount");
      expect(msgOf(r, "resources[0].amount")).to.contain("got string");
    });

    it("13 duplicate resource id", () => {
      const r = v(
        validPaid({
          resources: [
            { id: "cpu", amount: 1 },
            { id: "cpu", amount: 2 },
          ],
        }),
      );
      expect(paths(r)).to.include("resources[1].id");
      expect(msgOf(r, "resources[1].id")).to.contain("duplicate");
    });

    it("14 serviceIds length mismatch", () => {
      const r = v(validPaid({ datasets: ["a", "b"], serviceIds: ["a"] }));
      expect(paths(r)).to.include("serviceIds");
      expect(msgOf(r, "serviceIds")).to.contain("1-1");
    });

    it("15 serviceIds with null placeholder", () => {
      const r = v(validPaid({ datasets: ["a", "b"], serviceIds: ["a", null] }));
      expect(r.errors).to.deep.equal([]);
    });

    it("16 subsidyProviders tri-state", () => {
      expect(v(validPaid()).value!.subsidyProviders).to.equal(undefined);
      expect(
        v(validPaid({ subsidyProviders: [] })).value!.subsidyProviders,
      ).to.deep.equal([]);
      expect(
        v(validPaid({ subsidyProviders: "none" })).value!.subsidyProviders,
      ).to.deep.equal([]);
      expect(
        v(validPaid({ subsidyProviders: "NONE" })).value!.subsidyProviders,
      ).to.deep.equal([]);
      const lower = "0x" + "ab".repeat(20);
      expect(
        v(validPaid({ subsidyProviders: [lower] })).value!.subsidyProviders,
      ).to.deep.equal([ethers.getAddress(lower)]);
    });

    it("17 invalid subsidy provider address", () => {
      expect(paths(v(validPaid({ subsidyProviders: ["nope"] })))).to.include(
        "subsidyProviders[0]",
      );
    });

    it("18 suggests close key names", () => {
      const r = v(validPaid({ maxJobDuraton: 5 }));
      expect(paths(r)).to.include("maxJobDuraton");
      expect(msgOf(r, "maxJobDuraton")).to.contain(
        'did you mean "maxJobDuration"',
      );
    });

    it("19 suggests alias names", () => {
      const r = v(validPaid({ token: ADDR }));
      expect(msgOf(r, "token")).to.contain('did you mean "paymentToken"');
    });

    it("20 null equals absent", () => {
      const r = v(validPaid({ env: null, chainId: null }));
      expect(r.errors).to.deep.equal([]);
    });

    it("21 accept must be boolean", () => {
      expect(paths(v(validPaid({ accept: "true" })))).to.include("accept");
    });

    it("22 never echoes a value from the file", () => {
      const r = v(validPaid({ output: "TOPSECRET" }));
      expect(paths(r)).to.include("output");
      expect(msgOf(r, "output")).to.contain("got string");
      expect(formatSpecErrors("/x.json", r.errors)).to.not.contain("TOPSECRET");
    });
  });

  describe("validateComputeSpec (free)", () => {
    const v = (raw: Raw) => validateComputeSpec(raw, { free: true });
    it("23 minimal free spec", () => {
      expect(v({ datasets: [], algorithm: "did:op:b" }).errors).to.deep.equal(
        [],
      );
    });
    it("24 rejects paid-only keys", () => {
      const r = v({ datasets: [], algorithm: "did:op:b", paymentToken: ADDR });
      expect(paths(r)).to.include("paymentToken");
      expect(msgOf(r, "paymentToken")).to.contain(
        "not valid for startFreeCompute",
      );
    });
  });

  describe("computeSpecToInputs", () => {
    const toInputs = (raw: Raw) => {
      const r = validateComputeSpec(raw, { free: false });
      expect(r.errors).to.deep.equal([]);
      return computeSpecToInputs(r.value!);
    };

    it("25 DID-only datasets round-trip through parseComputeInput", () => {
      const i = toInputs(validPaid({ datasets: ["did:op:a", "did:op:c"] }));
      expect(parseComputeInput(i.dsDids)).to.deep.equal([
        "did:op:a",
        "did:op:c",
      ]);
      expect(i.aDid).to.equal("did:op:b");
    });

    it("26 mixed and raw inputs round-trip", () => {
      const datasets = [
        "did:op:a",
        { fileObject: { type: "url", url: "https://e.com/d", method: "GET" } },
      ];
      const algorithm = { fileObject: { type: "url", url: "https://e.com/a" } };
      const i = toInputs(validPaid({ datasets, algorithm }));
      expect(parseComputeInput(i.dsDids)).to.deep.equal(datasets);
      expect(parseComputeInput(i.aDid)[0]).to.deep.equal(algorithm);
    });

    it("27 empty datasets", () => {
      const i = toInputs(validPaid({ datasets: [] }));
      expect(i.dsDids).to.equal("[]");
      expect(parseComputeInput("[]")).to.deep.equal([]);
    });

    it("28 null serviceIds become placeholders", () => {
      const i = toInputs(
        validPaid({
          datasets: ["a", "b", "c"],
          serviceIds: ["s0", null, "s2"],
        }),
      );
      expect(i.svcIds).to.equal("s0,,s2");
    });

    it("29 defaults for absent service ids", () => {
      const i = toInputs(validPaid());
      expect(i.svcIds).to.equal("");
      expect(i.algoSvcId).to.equal("");
    });

    it("30 scalar conversions", () => {
      const i = toInputs(validPaid());
      expect(i.jobDuration).to.equal("900");
      expect(i.res).to.equal("[]");
      expect(i.outputLocation).to.equal(undefined);
    });
  });

  describe("validateServiceSpec", () => {
    const v = (raw: Raw) => validateServiceSpec(raw, { baseDir: tmpDir });
    const base = (extra: Raw = {}): Raw => ({
      env: "e",
      duration: 600,
      paymentToken: ADDR,
      image: "nginx",
      ...extra,
    });

    it("31 minimal valid", () => {
      expect(v(base()).errors).to.deep.equal([]);
    });

    it("32 reports missing required keys", () => {
      expect(paths(v({}))).to.include.members([
        "env",
        "duration",
        "paymentToken",
        "template",
      ]);
    });

    it("33 template and image together", () => {
      const r = v(base({ template: "t" }));
      expect(paths(r)).to.include("template");
      expect(msgOf(r, "template")).to.contain("not both");
    });

    it("34 tag and checksum together", () => {
      const r = v(base({ tag: "x", checksum: "sha256:abc" }));
      expect(r.errors.length).to.equal(1);
      expect(r.errors[0].message).to.contain("at most one");
    });

    for (const bad of [[0], [70000], ["80"]]) {
      it(`35 ports ${JSON.stringify(bad)} rejected`, () => {
        expect(paths(v(base({ ports: bad })))).to.include("ports[0]");
      });
    }

    it("36 cmd must be strings", () => {
      expect(paths(v(base({ cmd: ["a", 1] })))).to.include("cmd[1]");
    });

    it("37 userData and userDataFile together", () => {
      fs.writeFileSync(path.join(tmpDir, "ud.json"), "{}");
      const r = v(base({ userData: { A: "b" }, userDataFile: "ud.json" }));
      expect(paths(r)).to.include("userDataFile");
      expect(msgOf(r, "userDataFile")).to.contain("not both");
    });

    it("38 dockerfile resolved against baseDir", () => {
      fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM scratch");
      const r = v(base({ dockerfile: "Dockerfile" }));
      expect(r.errors).to.deep.equal([]);
      expect(r.value!.dockerfile).to.equal(path.join(tmpDir, "Dockerfile"));
    });

    it("39 missing dockerfile", () => {
      const r = v(base({ dockerfile: "missing" }));
      expect(paths(r)).to.include("dockerfile");
      expect(msgOf(r, "dockerfile")).to.contain("file not found");
    });

    it("40 additionalDockerFiles values must be strings", () => {
      expect(
        paths(v(base({ additionalDockerFiles: { "a.txt": 1 } }))),
      ).to.include("additionalDockerFiles.a.txt");
    });

    it("41 wait and timeout", () => {
      const r = v(base({ wait: false, timeout: 30 }));
      expect(r.value!.wait).to.equal(false);
      expect(r.value!.timeout).to.equal(30);
    });
  });

  describe("serviceSpecToInputs", () => {
    const toInputs = (raw: Raw) => {
      const r = validateServiceSpec(raw, { baseDir: tmpDir });
      expect(r.errors).to.deep.equal([]);
      return serviceSpecToInputs(r.value!);
    };
    const base = (extra: Raw = {}): Raw => ({
      env: "e",
      duration: 600,
      paymentToken: ADDR,
      template: "t",
      ...extra,
    });

    it("42 maps template, userData and resources", () => {
      const i = toInputs(
        base({
          userData: { A: "b" },
          resources: [{ id: "cpu", amount: 1 }],
        }),
      );
      expect(i.templateId).to.equal("t");
      expect(JSON.parse(i.userDataInline!)).to.deep.equal({ A: "b" });
      expect(JSON.parse(i.resources!)).to.deep.equal([
        { id: "cpu", amount: 1 },
      ]);
    });

    it("43 inline additionalDockerFiles", () => {
      const i = toInputs(base({ additionalDockerFiles: { "a.txt": "x" } }));
      expect(i.additionalDockerFiles).to.deep.equal({ "a.txt": "x" });
      expect(i.additionalDockerFilesPath).to.equal(undefined);
    });

    it("44 additionalDockerFiles as a path", () => {
      fs.writeFileSync(path.join(tmpDir, "adf.json"), "{}");
      const i = toInputs(base({ additionalDockerFiles: "adf.json" }));
      expect(i.additionalDockerFilesPath).to.equal(
        path.join(tmpDir, "adf.json"),
      );
      expect(i.additionalDockerFiles).to.equal(undefined);
    });
  });

  describe("readJsonSpecFile / load*", () => {
    it("45 missing file", () => {
      const p = path.join(tmpDir, "nope.json");
      expect(() => readJsonSpecFile(p)).to.throw(`Job file not found: ${p}`);
    });

    it("46 directory", () => {
      expect(() => readJsonSpecFile(tmpDir)).to.throw(/is a directory/);
    });

    it("47 invalid JSON does not echo content", () => {
      const p = path.join(tmpDir, "bad.json");
      fs.writeFileSync(p, '{ "a": TOPSECRET }');
      let msg = "";
      try {
        readJsonSpecFile(p);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).to.contain("is not valid JSON");
      expect(msg).to.not.contain("TOPSECRET");
    });

    it("48 top level must be an object", () => {
      const p = path.join(tmpDir, "arr.json");
      fs.writeFileSync(p, "[1,2]");
      expect(() => readJsonSpecFile(p)).to.throw(
        /JSON object at the top level/,
      );
    });

    it("49 expandHome", () => {
      expect(expandHome("~/x")).to.equal(path.join(os.homedir(), "x"));
      expect(expandHome("/abs")).to.equal("/abs");
    });

    it("50 loadComputeSpec aggregates problems", () => {
      const p = path.join(tmpDir, "two.json");
      fs.writeFileSync(p, JSON.stringify({ datasets: "x", algorithm: 5 }));
      let msg = "";
      try {
        loadComputeSpec(p, { free: true });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg.startsWith("Invalid job file")).to.equal(true);
      expect(msg).to.contain("(2 problems)");
      expect(msg).to.contain("datasets");
      expect(msg).to.contain("algorithm");
    });

    it("51 loadComputeSpec on a valid file", () => {
      const p = path.join(tmpDir, "ok.json");
      fs.writeFileSync(p, JSON.stringify(validPaid()));
      const i = loadComputeSpec(p, { free: false });
      expect(i.dsDids).to.be.a("string");
      expect(i.aDid).to.be.a("string");
      expect(i.jobDuration).to.be.a("string");
    });

    it("52 loadServiceSpec resolves paths against the file folder", () => {
      const sub = path.join(tmpDir, "sub");
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, "env.json"), "{}");
      const p = path.join(sub, "svc.json");
      fs.writeFileSync(
        p,
        JSON.stringify({
          env: "e",
          duration: 60,
          paymentToken: ADDR,
          image: "nginx",
          userDataFile: "env.json",
        }),
      );
      const i = loadServiceSpec(p);
      expect(i.userDataFilePath).to.equal(path.join(sub, "env.json"));
    });
  });
});
