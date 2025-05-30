import { test } from 'node:test'

test('pass 1', () => {})
test('pass 2', t => {
  t.after(() => {
    throw new Error('wyalla')
  })
})
test('fail', () => {
  throw new Error('fail')
})

test('subtest', async t => {
  test('subtest 1.1', async t => {
    test('subtest 1.1.1', () => {})
  })

  test('subtest 1.2', async t => {
    test('subtest 1.2.1', () => {
      throw new Error('fail')
    })
  })
})

test('mismatched', async (t, done) => {
  done()
})
