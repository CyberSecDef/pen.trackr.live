#!/usr/bin/env node
import { run } from './run.js'

const result = run(process.argv.slice(2))
const stream = result.exitCode === 0 ? process.stdout : process.stderr
stream.write(`${result.stdout}\n`)
process.exitCode = result.exitCode
