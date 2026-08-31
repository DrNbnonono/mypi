import assert from "node:assert/strict";
import test from "node:test";
import { getWebProcessEnvironment, isWsl, shouldUseLinuxTempDirectory } from "../bin/runtime-env.js";

test("detects WSL from environment or kernel release", () => {
  assert.equal(isWsl({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" }, release: "", procVersion: "" }), true);
  assert.equal(isWsl({ platform: "linux", env: {}, release: "5.15.153.1-microsoft-standard-WSL2", procVersion: "" }), true);
  assert.equal(isWsl({ platform: "linux", env: {}, release: "5.15.0", procVersion: "Linux version" }), false);
  assert.equal(isWsl({ platform: "win32", env: { WSL_DISTRO_NAME: "Ubuntu" }, release: "", procVersion: "" }), false);
});

test("uses /tmp for WSL processes whose temp directory is on a mounted Windows drive", () => {
  const options = {
    platform: "linux",
    env: { WSL_DISTRO_NAME: "Ubuntu", TMPDIR: "/mnt/c/Users/test/AppData/Local/Temp" },
    tmpdir: "/mnt/c/Users/test/AppData/Local/Temp",
    release: "5.15.0",
    procVersion: "",
  };
  assert.equal(shouldUseLinuxTempDirectory(options), true);
  assert.equal(getWebProcessEnvironment(options.env, options).TMPDIR, "/tmp");
});

test("leaves native and already-Linux temp directories unchanged", () => {
  assert.equal(
    getWebProcessEnvironment({ TMPDIR: "/tmp" }, {
      platform: "linux",
      tmpdir: "/tmp",
      env: { WSL_DISTRO_NAME: "Ubuntu", TMPDIR: "/tmp" },
      release: "5.15.0",
      procVersion: "",
    }).TMPDIR,
    "/tmp",
  );
  assert.equal(
    getWebProcessEnvironment({ TMPDIR: "C:\\Temp" }, {
      platform: "win32",
      tmpdir: "C:\\Temp",
      env: {},
      release: "",
      procVersion: "",
    }).TMPDIR,
    "C:\\Temp",
  );
});
