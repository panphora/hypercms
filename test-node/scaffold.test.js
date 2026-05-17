import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaffold } from '../src/scaffold.js'

test('scaffold: scalar string', () => {
  assert.equal(scaffold('h1'), '')
})

test('scaffold: scalar-array', () => {
  assert.deepEqual(scaffold('li[]'), [])
})

test('scaffold: object-array', () => {
  assert.deepEqual(scaffold(['.x', { y: 'z' }]), [])
})

test('scaffold: object', () => {
  assert.deepEqual(scaffold({ a: 'sel', b: 'sel[]' }), { a: '', b: [] })
})
