import { Transform } from 'node:stream'
import { type Callback, type TestError, type TestReportData } from '../../src/index.ts'

export class TestReporter extends Transform {
  constructor() {
    // c8 ignore next
    super({ writableObjectMode: true })
  }

  _transform(raw: { data?: TestReportData }, _encoding: string, callback: Callback<string>): void {
    if (raw.data) {
      if (raw.data.message?.startsWith('duration_ms ')) {
        raw.data.message = 'duration_ms 1000'
      }

      if (raw.data.file) {
        raw.data.file = raw.data.file.replace(process.cwd(), '/cleaner-spec-reporter')
      }

      raw.data.duration_ms = 1
      raw.data.line = 0
      raw.data.column = 0

      if (raw.data.details) {
        raw.data.details.duration_ms = 1

        if (raw.data.details.error) {
          raw.data.details.error = this.serializeError(raw.data.details.error as TestError) as unknown as TestError
        }
      }
    }

    callback(null, JSON.stringify(raw) + '\n')
  }

  serializeError(error: TestError): object {
    const serialized: Record<string, any> = {
      message: error.message ?? error.cause,
      code: error.code,
      failureType: error.failureType
    }

    if (error.stack) {
      serialized.stack = this.sanitizeOutput(error.stack!)
    }

    serialized.message = error.message ?? error.cause

    if (error.cause && typeof error.cause !== 'string') {
      serialized.cause = this.serializeError(error.cause as TestError)
    }

    return serialized
  }

  sanitizeOutput(output: string): string {
    return output
      .replaceAll(/ +$/gm, '')
      .replaceAll(process.cwd(), '/cleaner-spec-reporter')
      .replaceAll(/:\d+:\d+\)/g, ':0:0)')
      .replaceAll(/:\d+\)/g, ':0)')
      .trim()
  }
}

export default TestReporter
