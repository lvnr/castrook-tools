#!/usr/bin/env node
import { runCLI } from "./cli-core.js";

void runCLI(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write("Castrook could not finish this command. No credentials were printed.\n");
  process.exitCode = 5;
});
