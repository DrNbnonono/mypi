import assert from "node:assert/strict";
import test from "node:test";
import {
  getWebProcessEnvironment,
  isWsl,
  shouldUseLinuxTempDirectory,
  shouldUseLinuxWebpackCache,
} from "../bin/runtime-env.js";

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

test("moves the WSL dev webpack cache off a mounted Windows drive", () => {
  const cwd = "/mnt/e/mypi/packages/web-ui";
  const options = {
    command: "dev",
    cwd,
    platform: "linux",
    env: { WSL_DISTRO_NAME: "Ubuntu", TMPDIR: "/tmp" },
    tmpdir: "/tmp",
    release: "5.15.0",
    procVersion: "",
  };

  assert.equal(shouldUseLinuxWebpackCache(options), true);
  const childEnv = getWebProcessEnvironment(options.env, options);
  assert.match(childEnv.PI_WEB_WEBPACK_CACHE_DIR, /^\/tmp\/pi-web-webpack-[a-f0-9]{12}$/);
  assert.match(childEnv.PI_WEB_NEXT_OUTPUT_DIR, /^\/tmp\/pi-web-next-[a-f0-9]{12}$/);
  assert.equal(
    getWebProcessEnvironment(options.env, { ...options, command: "start" }).PI_WEB_WEBPACK_CACHE_DIR,
    undefined,
  );
  assert.equal(
    getWebProcessEnvironment(options.env, { ...options, command: "start" }).PI_WEB_NEXT_OUTPUT_DIR,
    undefined,
  );
});
