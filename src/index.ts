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

const SUMMARY_MATCHER = /(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+\d+(\.\d+)?/

export function indent(nesting: number): string {
  return ' '.repeat(nesting)
}

export function pluralize(word: string, count: number): string {
  return `${word}${count > 1 ? 's' : ''}`
}

export function duration(start: number, now?: number): string {
  let difference = ((now ?? Date.now()) - start) / 1000
  const message = []

  if (difference >= 3600) {
    const hours = Math.floor(difference / 3600)
    message.push(`${hours} ${pluralize('hour', hours)}`)
    difference = difference % 3600
  }

  if (difference >= 60) {
    const minutes = Math.floor(difference / 60)
    message.push(`${minutes} ${pluralize('minute', minutes)}`)
    difference = difference % 60
  }

  message.push(
    `${difference.toFixed(Math.round(difference) !== difference ? 3 : 0)} ${pluralize('second', difference)}`
  )

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
  #start: number
  #success: boolean
  #filesCount: number
  #currentFile: string
  #failedTests: TestReport['data'][]
  #counters: Record<string, number>
  #symbols: Record<string, string>
  #hasColors: boolean
  #colors: Record<string, string>
  #diagnosticShown: boolean
  #diagnosticLastLevel: number

  constructor() {
    // c8 ignore next
    super({ writableObjectMode: true })

    this.#start = Date.now()
    this.#success = false
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

    this.#diagnosticShown = false
    this.#diagnosticLastLevel = -1

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

    const { blue, green, red, gray, reset, bold } = this.#colors
    const { rightArrow, fail, pass, diagnostic } = this.#symbols

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

        if (!data.file) {
          callback(null, message)
          return
        }

        if (data.file !== this.#currentFile) {
          this.#diagnosticShown = false
          this.#currentFile = data.file
          this.#filesCount++

          message = [
            /* c8 ignore next */
            this.#filesCount > 1 ? '\n' : '',
            gray,
            rightArrow,
            `File ${bold}${relative(process.cwd(), data.file)}\n\n`
          ].join('')
        }

        break
      case 'test:pass':
        if (data.file?.endsWith(data.name)) {
          callback(null, message)
          return
        }

        message = `${indent(2)}${green}${pass}${data.name} ${gray}(${data.details!.duration_ms}ms)\n`
        break
      case 'test:fail':
        if (data.file?.endsWith(data.name)) {
          callback(null, message)
          return
        }

        this.#failedTests.push(data)
        message = `${indent(2)}${red}${fail}${data.name} ${gray}(${data.details!.duration_ms}ms)${reset}${this.#formatError(data.details!.error!)}`
        break
      case 'test:diagnostic':
        {
          const level = data.message?.match(SUMMARY_MATCHER) ? 0 : 2

          if (this.#diagnosticShown && this.#diagnosticLastLevel !== level) {
            this.#diagnosticShown = false
          }

          this.#diagnosticLastLevel = level

          message = `${indent(level)}${blue}${diagnostic}${data.message}\n`

          if (!this.#diagnosticShown) {
            this.#diagnosticShown = true
            message = '\n' + message
          }
        }

        break
      case 'test:summary':
        this.#success = data.success!

        for (const [key, value] of Object.entries(data.counts!)) {
          this.#counters[key] ??= 0
          this.#counters[key] += value
        }

        break
    }

    callback(null, message + reset)
  }

  _flush(callback: Callback<string>): void {
    callback(null, this.#formatSummary())
  }

  #formatSummary(): string {
    const { normal, blue, green, red, gray, reset, bold } = this.#colors
    const { rightArrow, fail } = this.#symbols
    const count = this.#filesCount

    if (this.#filesCount === 0) {
      return `${blue}${rightArrow}No tests to run or all test might have been skipped or excluded.\n`
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

    message += `${blue}${rightArrow}Execution ${bold}`
    /* c8 ignore next */
    message += this.#success && this.#failedTests.length === 0 ? `${green}PASSED` : `${red}FAILED`
    message += reset + blue + ` after ${duration(this.#start)}`
    message += ` with ${passed + todo} ${pluralize('test', passed)} passing out of ${tests}${nonExecuted} over ${count} ${pluralize('file', count)}.`

    if (this.#failedTests.length > 0) {
      const filesWithFailures = new Set()
      message += `\n\n${red}${fail}Failed tests:\n\n${reset}`

      for (const fail of this.#failedTests) {
        const file = relative(process.cwd(), fail.file!)
        filesWithFailures.add(file)
        message += `${indent(2)}${gray}-${reset} ${bold}${fail.name}${normal} ${gray}(${file}:${fail.line})${reset}\n`
      }

      message += `\n${red}${fail}Files with failures:\n\n${reset}`
      for (const file of filesWithFailures) {
        message += `${indent(2)}${gray}-${reset} ${bold}${file}${normal}\n`
      }
    }

    return message + '\n\n'
  }

  #formatError(error: Error): string {
    const indentation = '\n' + indent(6)

    if ((error as ErrorWithCode).code === 'ERR_TEST_FAILURE') {
      error = error.cause as Error
    }

    return (
      '\n' +
      indentation +
      inspect(error, { colors: this.#hasColors, customInspect: true, depth: 10 }).split(/\r?\n/).join(indentation) +
      '\n\n'
    )
  }
}

export default TestReporter
