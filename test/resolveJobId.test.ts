import { expect } from "chai";
import { resolveJobId } from "../src/helpers.js";

// Pure unit test, no infra: covers the argument resolution for the job-only
// compute commands (getJobStatus / stopCompute) after the legacy dataset-DID
// requirement was dropped.
describe("resolveJobId", function () {
  it("treats a single positional as the job id", function () {
    expect(resolveJobId("job-123")).to.equal("job-123");
  });

  it("drops a leading legacy dataset DID and keeps the job id", function () {
    expect(resolveJobId("did:op:abc", "job-123")).to.equal("job-123");
  });

  it("drops a leading DID and ignores a trailing legacy agreement id", function () {
    expect(resolveJobId("did:op:abc", "job-123", "agreement-xyz")).to.equal(
      "job-123",
    );
  });

  it("ignores an empty trailing positional (legacy '' agreement arg)", function () {
    expect(resolveJobId("did:op:abc", "job-123", "")).to.equal("job-123");
  });

  it("lets --job win over positionals", function () {
    expect(
      resolveJobId("did:op:abc", "job-positional", undefined, {
        job: "job-option",
      }),
    ).to.equal("job-option");
  });

  it("returns undefined when nothing is provided", function () {
    expect(resolveJobId(undefined, undefined, undefined)).to.equal(undefined);
    expect(resolveJobId("")).to.equal(undefined);
  });

  it("does not drop a non-DID first positional", function () {
    // A job id that is not a DID stays the job id even with extra positionals.
    expect(resolveJobId("job-123", "extra")).to.equal("job-123");
  });
});
