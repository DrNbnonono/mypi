#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareProductionOutputDirectory } from "./dev-output.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
prepareProductionOutputDirectory(packageDir);
