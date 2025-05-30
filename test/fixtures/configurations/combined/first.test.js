import { test } from 'node:test'

test('todo', { todo: true }, t => {
  t.diagnostic('todoAA 1')
  t.diagnostic('todoAA 2')
})

test('todoWithMessage', { todo: 'WTF' }, t => {
  t.diagnostic('todoWithMessage 1\nThis is with a new line')
  t.diagnostic('todoWithMessage 2')
  throw new Error('fail')
})

test('skip', { skip: true }, () => {})

test('pass', t => {})

test('fail', () => {
  throw new Error('fail')
})

test('subtest', async t => {
  await t.test('subtest 1', async t => {
    await t.test('subtest 1.1', async t => {
      await t.test('subtest 1.1.1', () => {})
      await t.test('subtest 1.1.2', () => {})
      await test('subtest 1.1.3', () => {
        throw new Error('fail')
      })
      await t.test('subtest 1.1.1', () => {})
    })
  })

  await t.test('subtest 2', () => {})

  await test('subtest 3', () => {
    throw new Error('fail')
  })

  for (let i = 0; i < 3; i++) {
    await t.test('subtest 4', async t => {
      await t.test('subtest 4.1', { timeout: 100 }, (_, done) => {
        setTimeout(() => {
          done()
        }, 200)
      })

      await test('subtest 4.2', t => {
        t.diagnostic('subtest 4.2')
        throw new Error('fail')
      })
    })
  }
})

test('local timeout', { timeout: 100 }, (_, done) => {
  setTimeout(() => {
    done()
  }, 200)
})

test('timeout', (_, done) => {
  setTimeout(() => {
    done()
  }, 1000)
})

test('cancelled', () => {})
