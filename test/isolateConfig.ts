import fs from "fs";
import os from "os";
import path from "path";

// Point every CLI process spawned by the tests (they inherit process.env) at a
// throwaway config file, so tests never read or modify the developer's real
// ~/.ocean/cli/config.json.
process.env.OCEANCLI_CONFIG_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "oceancli-test-")),
  "config.json",
);
delete process.env.RPC_CONFIG_FILE;
