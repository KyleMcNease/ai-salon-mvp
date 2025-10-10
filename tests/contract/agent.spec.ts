/* @jest-environment node */
import { makeAgent } from '../../packages/scribe-sdk/src'
test('runTask basic contract', async () => {
  const agent = makeAgent()
  const res = await agent.runTask("Say 'hello world'")
  expect(res).toHaveProperty('taskId')
})
