import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  keywordLabel,
  keywordPaths,
  parseKeywordInput,
  suggestKeywords
} from '../src/shared/keywords'

test('typed keywords: levels by > or |, several by commas', () => {
  assert.deepEqual(parseKeywordInput('Places > Canada > Winnipeg'), ['Places|Canada|Winnipeg'])
  assert.deepEqual(parseKeywordInput('Places|Canada'), ['Places|Canada'])
  assert.deepEqual(parseKeywordInput(' dog, Nature >Water ; dog '), ['dog', 'Nature|Water'])
  assert.deepEqual(parseKeywordInput(' > , | '), [])
  assert.deepEqual(parseKeywordInput('A >> B'), ['A|B'])
})

test('keywordLabel reads a path', () => {
  assert.equal(keywordLabel('Places|Canada'), 'Places › Canada')
})

const tree = [
  {
    name: 'Places',
    path: 'Places',
    count: 2,
    children: [
      {
        name: 'Canada',
        path: 'Places|Canada',
        count: 2,
        children: [{ name: 'Winnipeg', path: 'Places|Canada|Winnipeg', count: 1, children: [] }]
      }
    ]
  },
  { name: 'Candid', path: 'Candid', count: 1, children: [] },
  { name: 'Volcano', path: 'Volcano', count: 1, children: [] }
]

test('keywordPaths walks the tree, parents first', () => {
  assert.deepEqual(keywordPaths(tree), [
    'Places',
    'Places|Canada',
    'Places|Canada|Winnipeg',
    'Candid',
    'Volcano'
  ])
})

test('suggestions: a level starting with the text first, then containing it, minus those taken', () => {
  const paths = keywordPaths(tree)
  assert.deepEqual(suggestKeywords(paths, 'can'), [
    'Places|Canada',
    'Places|Canada|Winnipeg',
    'Candid',
    'Volcano'
  ])
  assert.deepEqual(suggestKeywords(paths, 'can', ['Candid'], 2), [
    'Places|Canada',
    'Places|Canada|Winnipeg'
  ])
  assert.deepEqual(suggestKeywords(paths, 'places > canada'), [
    'Places|Canada',
    'Places|Canada|Winnipeg'
  ])
  assert.deepEqual(suggestKeywords(paths, '  '), [])
})
