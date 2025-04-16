import { relative } from 'node:path'
import { Transform } from 'node:stream'
import { inspect } from 'node:util'

export interface ErrorWithCode extends Error {
  code: string
}

export type Callback<T> = (error?: Error | null, data?: T) => void

interface TestReport {
  type: string
  data: {
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
  }
}

export class TestReporter extends Transform {
  #pending: number
  #filesCount: number
  #currentFile: string
  #failedTests: TestReport['data'][]
  #counters: Record<string, number>
  #symbols: Record<string, string>
  #hasColors: boolean
  #colors: Record<string, string>

  constructor() {
    // c8 ignore next
    super({ writableObjectMode: true })

    this.#pending = 0
    this.#filesCount = 0
    this.#currentFile = ''
    this.#failedTests = []
    this.#counters = {}

    this.#symbols = {
      fail: '\u2716 ',
      pass: '\u2714 ',
      diagnostic: '\u2139 ',
      coverage: '\u2139 ',
      rightArrow: '\u25B6 ',
      hyphen: '\uFE63 '
    }

    this.#hasColors = false
    this.#colors = {
      blue: '',
      green: '',
      white: '',
      yellow: '',
      red: '',
      gray: '',
      clear: '',
      bold: '',
      normal: '',
      reset: ''
    }

    if (process.env.FORCE_COLOR !== undefined || (process.stderr.isTTY && process.stderr.getColorDepth() > 2)) {
      this.#hasColors = true

      this.#colors = {
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
    }
  }

  _transform({ type, data }: TestReport, _encoding: string, callback: Callback<string>): void {
    /* c8 ignore next 4 */
    let message = ''

    switch (type) {
      case 'test:stderr':
      case 'test:stdout':
        message = data.message!
        break
      case 'test:start':
        /* c8 ignore next 4 */
        if (data.file?.endsWith(data.name)) {
          callback(null, message)
          return
        }

        this.#pending++
        if (!data.file) {
          callback(null, message)
          return
        }

        if (data.file !== this.#currentFile) {
          this.#currentFile = data.file
          this.#filesCount++

          message = [
            /* c8 ignore next */
            this.#filesCount > 1 ? '\n' : '',
            this.#colors.gray,
            this.#symbols.rightArrow,
            `File ${this.#colors.bold}${relative(process.cwd(), data.file)}\n\n`
          ].join('')
        }

        break
      case 'test:pass':
        if (data.file?.endsWith(data.name)) {
          callback(null, message)
          return
        }

        this.#pending--
        message = `${this.#indent(2)}${this.#colors.green}${this.#symbols.pass}${data.name} ${this.#colors.gray}(${
          data.details!.duration_ms
        }ms)\n`
        break
      case 'test:fail':
        if (data.file?.endsWith(data.name)) {
          callback(null, message)
          return
        }

        this.#pending--
        this.#failedTests.push(data)
        message = `${this.#indent(2)}${this.#colors.red}${this.#symbols.fail}${data.name} ${this.#colors.gray}(${
          data.details!.duration_ms
        }ms)${this.#colors.reset}${this.#formatError(data.details!.error!)}`
        break
      case 'test:diagnostic':
        if (this.#pending > 0) {
          message = `${this.#indent(2)}${this.#colors.blue}${this.#symbols.diagnostic}${data.message}\n`
        }
        break
      case 'test:summary':
        for (const [key, value] of Object.entries(data.counts!)) {
          this.#counters[key] ??= 0
          this.#counters[key] += value
        }

        break
    }

    callback(null, message + this.#colors.reset)
  }

  _flush(callback: Callback<string>): void {
    callback(null, this.#formatSummary())
  }

  #formatSummary(): string {
    if (this.#filesCount === 0) {
      return `${this.#colors.blue}${
        this.#symbols.rightArrow
      }No tests to run or all test might have been skipped or excluded.`
    }

    let message = '\n'
    let nonExecuted = ''
    const { passed, tests, skipped, todo, cancelled } = this.#counters

    if (skipped > 0 || todo > 0 || cancelled > 0) {
      nonExecuted = ' ('
      let comma = ''

      if (skipped > 0) {
        nonExecuted += `skipped: ${skipped}`
        comma = ', '
      }

      if (todo > 0) {
        nonExecuted += `${comma}TODO: ${todo}`
        comma = ', '
      }

      if (cancelled > 0) {
        nonExecuted += `${comma}cancelled: ${cancelled}`
      }

      nonExecuted += ')'
    }

    message += `${this.#colors.blue}${this.#symbols.rightArrow}Execution ${this.#colors.bold}`
    message += this.#failedTests.length === 0 ? `${this.#colors.green}PASSED` : `${this.#colors.red}FAILED`
    message += this.#colors.reset + this.#colors.blue
    message += ` with ${passed + todo} ${this.#pluralize('test', passed)} passing out of ${tests}${nonExecuted} over ${this.#filesCount} ${this.#pluralize('file', this.#filesCount)}.`

    if (this.#failedTests.length > 0) {
      const filesWithFailures = new Set()
      message += `\n\n${this.#colors.red}${this.#symbols.fail}Failed tests:\n\n${this.#colors.reset}`

      for (const fail of this.#failedTests) {
        const file = relative(process.cwd(), fail.file!)
        filesWithFailures.add(file)
        message += `${this.#indent(2)}${this.#colors.gray}-${this.#colors.reset} ${this.#colors.bold}${fail.name}${
          this.#colors.normal
        } ${this.#colors.gray}(${file}:${fail.line})${this.#colors.reset}\n`
      }

      message += `\n${this.#colors.red}${this.#symbols.fail}Files with failures:\n\n${this.#colors.reset}`
      for (const file of filesWithFailures) {
        message += `${this.#indent(2)}${this.#colors.gray}-${this.#colors.reset} ${this.#colors.bold}${file}${
          this.#colors.normal
        }\n`
      }
    }

    return message + '\n\n'
  }

  #formatError(error: Error): string {
    const indent = '\n' + this.#indent(6)

    if ((error as ErrorWithCode).code === 'ERR_TEST_FAILURE') {
      error = error.cause as Error
    }

    return (
      '\n' +
      indent +
      inspect(error, { colors: this.#hasColors, customInspect: true, depth: 10 }).split(/\r?\n/).join(indent) +
      '\n\n'
    )
  }

  #indent(nesting: number): string {
    return ' '.repeat(nesting)
  }

  #pluralize(word: string, count: number): string {
    return `${word}${count > 1 ? 's' : ''}`
  }
}

export default TestReporter
