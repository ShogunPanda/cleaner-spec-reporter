import { relative } from 'node:path'
import { Transform } from 'node:stream'
import { inspect } from 'node:util'

export interface TestError extends Error {
  code: string
  failureType: string
  cause: Error | string
}

export type Callback<T> = (error?: Error | null, data?: T) => void

export interface TestReportData {
  message?: string
  name: string
  nesting: number
  file?: string
  line?: number
  column?: number
  success?: boolean
  counts?: Record<string, number>
  details?: {
    duration_ms?: number
    error?: Error
  }
  todo: boolean | string
  skip: boolean
  duration_ms?: number
}

export interface TestReport {
  type: string
  data: TestReportData
}

const SUBTESTS_FAILED = /^(\d+) subtest(s)? failed$/
const FAILED_HOOK_MATCHER = /failed running (.+) hook/
const SUMMARY_MATCHER = /(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+(\d+(\.\d+)?)/

export function pastBeingVerb(count: number): string {
  return count === 1 ? 'was' : 'were'
}

export function pluralize(word: string, count: number): string {
  return `${word}${count > 1 || (count > 0 && count < 1) ? 's' : ''}`
}

export function formatDuration(duration: number): string {
  duration /= 1000
  const message = []

  if (duration >= 3600) {
    const hours = Math.floor(duration / 3600)
    message.push(`${hours} ${pluralize('hour', hours)}`)
    duration = duration % 3600
  }

  if (duration >= 60) {
    const minutes = Math.floor(duration / 60)
    message.push(`${minutes} ${pluralize('minute', minutes)}`)
    duration = duration % 60
  }

  message.push(`${duration.toFixed(Math.round(duration) !== duration ? 3 : 0)} ${pluralize('second', duration)}`)

  return niceJoin(message)
}

export function niceJoin(array: string[], lastSeparator: string = ' and ', separator: string = ', '): string {
  switch (array.length) {
    case 0:
      return ''
    case 1:
      return array[0]
    case 2:
      return array.join(lastSeparator)
    default:
      return array.slice(0, -1).join(separator) + lastSeparator + array.at(-1)!
  }
}

export class TestReporter extends Transform {
  #cwd: string
  #colors: Record<string, string>
  #success: boolean
  #counters: Record<string, number>
  #files: Set<string>
  #failures: Map<string, (TestReportData & { fullName: string })[]>
  #executing: string[]
  #nesting: number
  #currentFile: string
  #diagnosticShown: boolean

  static symbols: Record<string, string> = {
    fail: '\u2716 ',
    pass: '\u2714 ',
    diagnostic: '\u2139 ',
    coverage: '\u2139 ',
    rightArrow: '\u25B6 ',
    hyphen: '\uFE63 ',
    verticalBar: '\u2502'
  }

  static colors: Record<string, string> = {
    blue: '\u001b[34m',
    green: '\u001b[32m',
    white: '\u001b[39m',
    yellow: '\u001b[33m',
    red: '\u001b[31m',
    gray: '\u001b[90m',
    clear: '\u001bc',
    bold: '\u001b[1m',
    normal: '\u001b[22m',
    reset: '\u001b[0m'
  }

  static errorColors: Record<string, string> = {
    bigint: 'yellow',
    boolean: 'yellow',
    date: 'magenta',
    module: 'underline',
    name: '',
    null: 'bold',
    number: 'yellow',
    regexp: 'red',
    special: 'cyan',
    string: 'red',
    symbol: 'red',
    undefined: 'grey'
  }

  constructor() {
    super({ writableObjectMode: true })

    /* c8 ignore next - else */
    this.#cwd = process.env.TEST_ROOT ?? process.cwd()
    this.#success = true
    this.#counters = {}
    this.#files = new Set()
    this.#failures = new Map()
    this.#executing = []
    this.#nesting = 0
    this.#currentFile = ''
    this.#diagnosticShown = false

    if (
      process.env.FORCE_COLOR === 'true' ||
      /* c8 ignore next - else */
      (process.env.NO_COLOR !== 'true' && process.stderr.isTTY && process.stderr.getColorDepth() > 2)
    ) {
      this.#colors = TestReporter.colors
    } else {
      this.#colors = Object.fromEntries(Object.keys(TestReporter.colors).map(key => [key, '']))
    }
  }

  _transform({ type, data }: TestReport, _encoding: string, callback: Callback<string>): void {
    let message = ''

    switch (type) {
      case 'test:enqueue':
        if (!this.#files.has(data.file!)) {
          this.#files.add(data.file!)
        }
        break
      /* c8 ignore next 4 */
      case 'test:stderr':
      case 'test:stdout':
        message = data.message!
        break
      case 'test:start':
        message = this.#handleTestStart(data)
        break
      case 'test:pass':
        if (!this.#isFile(data)) {
          message = this.#handleTestEnd(data, true)
        }

        break
      case 'test:fail':
        message = this.#handleTestEnd(data, false)
        break
      case 'test:diagnostic':
        message = this.#handleDiagnostic(data)
        break
      case 'test:summary':
        this.#success = data.success!
        break
      default:
        break
    }

    callback(null, message + this.#colors.reset)
  }

  _flush(callback: Callback<string>): void {
    const { normal, blue, green, red, gray, reset, bold } = this.#colors
    const { rightArrow, fail } = TestReporter.symbols

    // No file were executed
    if (!this.#currentFile) {
      callback(null, `\n${blue}${rightArrow}No tests to run or all test might have been skipped or excluded.\n\n`)
      return
    }

    let message = '\n'
    const { duration_ms: duration, pass: passed, tests, skipped, todo, cancelled } = this.#counters
    const files = this.#files.size

    const todoMessage = todo > 0 ? ` (including ${bold}${todo} ${pluralize('TODO', passed)}${normal})` : ''
    message += `${blue}${rightArrow}${bold}Execution ${bold}`
    message += this.#success ? `${green}PASSED` : `${red}FAILED`
    message += reset + blue + ` after ${bold}${formatDuration(duration)}${normal}`
    message += ` with ${bold}${passed + todo} ${pluralize('test', passed + todo)}${normal}${todoMessage} passing out of ${bold}${tests} ${pluralize('test', tests)}${normal} over ${bold}${files} ${pluralize('file', files)}${normal}`

    if (skipped > 0 || todo > 0 || cancelled > 0) {
      const nonExecuted = []

      if (skipped > 0) {
        nonExecuted.push(`${bold}${skipped} ${pluralize('test', skipped)}${normal} ${pastBeingVerb(skipped)} skipped`)
      }

      if (cancelled > 0) {
        nonExecuted.push(
          `${bold}${cancelled} ${pluralize('test', cancelled)}${normal} ${pastBeingVerb(cancelled)} cancelled`
        )
      }

      if (nonExecuted.length > 0) {
        message += ' (' + niceJoin(nonExecuted) + ').'
      }
    } else {
      message += '.'
    }

    if (this.#failures.size > 0) {
      const fileIndentation = this.#indent(1)
      const testIndentation = this.#indent(2)

      const filesWithFailures = new Set<string>()
      message += `\n\n${red}${bold}${fail}Failed tests:\n${fileIndentation}\n${reset}`

      let i = 0

      for (const [file, failures] of this.#failures) {
        const relativeFile = relative(this.#cwd, file)
        filesWithFailures.add(relativeFile)

        if (i++ > 0) {
          message += testIndentation + '\n'
        }

        message += `${this.#indent(1)}${gray}${rightArrow}${bold}${relativeFile}${reset}\n${testIndentation}\n`

        for (const { fullName, line } of failures) {
          message += `${this.#indent(2)}${gray}-${reset} ${bold}${fullName}${normal} ${gray}(${relativeFile}:${line})${reset}\n`
        }
      }

      message += `\n${red}${bold}${fail}Files with failures:\n${fileIndentation}\n${reset}`
      for (const file of filesWithFailures) {
        message += `${this.#indent(1)}${gray}-${reset} ${bold}${file}${normal}\n`
      }
    }

    callback(null, message + '\n\n')
  }

  #handleTestStart(data: TestReportData): string {
    // Consider the next test as already enqueued
    const indentation = this.#indent(1)

    let message = ''
    const { gray, bold, normal } = this.#colors
    const { rightArrow } = TestReporter.symbols

    if (this.#isFile(data)) {
      return ''
    }

    if (data.file !== this.#currentFile) {
      if (this.#currentFile) {
        message += indentation + '\n'
      }

      this.#currentFile = data.file!
      message += `${gray}${bold}${rightArrow}${normal}${relative(this.#cwd, data.file!)}\n${indentation}\n`
    } else if (this.#diagnosticShown) {
      this.#diagnosticShown = false

      message += this.#indent(2) + '\n'
    }

    // This happens if handleTestStart is called again before the test has ended, which means we are executing a subtest.
    if (data.nesting > this.#nesting) {
      message += `${this.#indent()}${rightArrow}${this.#executing.at(-1)}\n${this.#indent(1)}\n`
    }

    this.#executing.push(data.name)
    this.#nesting = data.nesting

    return message
  }

  #handleTestEnd(data: TestReportData, passed: boolean): string {
    let message = ''
    const { green, red, gray, reset, bold, normal } = this.#colors
    const { pass, fail } = TestReporter.symbols

    const todo = typeof data.todo === 'string' && data.todo ? `:${normal} ${data.todo}` : ''

    if (!this.#isFile(data)) {
      this.#executing.pop()
    }

    let name = data.name
    const fullName = this.#getFullTestName(data)

    if (passed) {
      if (data.skip) {
        message = `${gray}${pass}`
      } else {
        message = `${green}${pass}`
      }

      message += `${name} ${gray}(${data.details!.duration_ms}ms)${reset}`

      if (data.todo) {
        message += ` ${bold}# TODO${todo}${reset}`
      } else if (data.skip) {
        message += ` ${bold}# SKIP${reset}`
      }

      message += '\n'
    } else {
      if (this.#isFile(data)) {
        name = relative(this.#cwd, data.file!)
      } else {
        const file = data.file!
        let failures = this.#failures.get(file)

        if (!failures) {
          failures = []
          this.#failures.set(file, failures)
        }

        failures.push({ ...data, fullName })
        name = data.name
      }

      message = `${red}${fail}`

      const error = data.details?.error! as TestError
      const durationFooter = `${gray}(${data.details!.duration_ms}ms)${reset}\n`

      switch (error.failureType) {
        case 'callbackAndPromisePresent':
          message += `${name} - Test both accepted a callback but returned a Promise. ${durationFooter}`
          break
        case 'cancelledByParent':
          message += `${name} - Test cancelled by its parent. ${durationFooter}`
          break
        /* c8 ignore next 3 - Hard to test */
        case 'testAborted':
          message += `${name} - Test aborted. ${durationFooter}`
          break
        /* c8 ignore next 3 - Hard to test */
        case 'parentAlreadyFinished':
          message += `${name} - Parent test already completed. ${durationFooter}`
          break
        case 'subtestsFailed':
          {
            /* c8 ignore next - else */
            const amount = parseInt(error.message?.match(SUBTESTS_FAILED)?.[1] ?? '0', 10)
            message += `${name} - ${amount} ${pluralize('subtest', amount)} failed. ${durationFooter}`
          }
          break
        case 'testCodeFailure':
          message += `${name} ${durationFooter}${this.#formatError(error.cause)}`
          break
        case 'testTimeoutFailure':
          message += `${name} - Test timed out after ${this.#getTimeoutErrorValue(error)}ms. ${durationFooter}`
          break
        case 'hookFailed':
          {
            /* c8 ignore next - else */
            const hook = error.message?.match(FAILED_HOOK_MATCHER)?.[1] ?? 'unknown'
            message += `${name} - Error while running ${hook} hook. ${durationFooter}${this.#formatError(error.cause)}`
          }
          break
      }

      if (this.#isFile(data)) {
        message = this.#indent(0, true) + '\n' + message
      }
    }

    if (data.nesting < this.#nesting) {
      message = `${this.#indent(2)}\n${this.#indent(1)}` + message
    } else if (!this.#isFile(data)) {
      message = this.#indent(1) + message
    }

    this.#nesting = data.nesting

    return message
  }

  #handleDiagnostic(data: TestReportData): string {
    const mo = data.message?.match(SUMMARY_MATCHER)

    if (mo) {
      this.#counters[mo[1]] = parseFloat(mo[2])

      return ''
    }

    this.#diagnosticShown = true

    const { blue } = this.#colors
    const { diagnostic } = TestReporter.symbols

    // Diagnostic messages are shown after the test has finished, so 1 level for indentation of test and 1 for the diagnostic
    const formatted = data.message!.split('\n').map((line, i) => {
      return i > 0 ? `${this.#indent(2)}${this.#indent(1, true, false)}${blue}${line}` : line
    })

    const message = `${this.#indent(2)}${blue}${diagnostic}${formatted.join('\n')}\n`

    return message
  }

  #formatError(error: Error | string): string {
    // One for the already popped test, one for the current context
    const indentation = this.#indent(2)

    if (typeof error !== 'string') {
      error = inspect(error, { colors: false, customInspect: true, depth: 10 })
    }
    const formatted = error.split(/\r?\n/).join('\n') + '\n'

    return indentation + '\n' + formatted.replaceAll(/(^.)/gm, `${indentation}$1`) + indentation + '\n'
  }

  #isFile(data: TestReportData): boolean {
    return Boolean(data.file && data.file.endsWith(data.name))
  }

  #getFullTestName(data: TestReportData): string {
    return [...this.#executing, data.name].join(` ${TestReporter.symbols.rightArrow}`)
  }

  #getTimeoutErrorValue(error: Error | undefined): number {
    const mo = error?.message?.match(/^test timed out after (\d+)ms$/)
    /* c8 ignore next - else */
    return parseInt(mo?.[1] ?? '0', 10)
  }

  #indent(level: number = 0, absolute: boolean = false, useSymbol: boolean = true): string {
    const { gray, reset } = this.#colors
    const verticalBar = useSymbol && gray !== '' ? TestReporter.symbols.verticalBar : ' '
    const length = ((absolute ? 0 : this.#executing.length) + level) * 2

    let indentation = ''

    if (level === 0 && absolute) {
      indentation = verticalBar
    } else {
      for (let i = 0; i < length; i++) {
        indentation += i % 2 === 0 ? verticalBar : ' '
      }
    }

    return `${gray}${indentation}${reset}`
  }
}

export default TestReporter
