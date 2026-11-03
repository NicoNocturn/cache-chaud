import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000
const BAND = {
  plugin: 'cache-chaud',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 80, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

// Le moteur sous le mod : une session à 300k tokens, des rappels qui relisent `lu` tokens.
function moteur(on: On, lu = 300_000) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 3, 8, 0) })
  const rappels: number[] = []
  const toasts: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 299_000, cache_creation_input_tokens: 1000 } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 300_000, window: 1_000_000 }, rateLimits: [] } }))
  on('model.fork', () => {
    rappels.push(clock.now())
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 40, output_tokens: 5, cache_read_input_tokens: lu, cache_creation_input_tokens: 300_000 - lu } } }
  })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'cache-chaud' } }))
  // ce que le moteur dessine quand le mod laisse la place
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>moteur</Text>
  })
  return { clock, rappels, toasts }
}

async function unTour($: Engine, texte = 'Corrige le deck') {
  await $.prompt.submit({ text: texte, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: texte, turnId: 't' })
  await $.turn.complete({ answer: 'fait', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' })
}

async function bandeau($: Engine) {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const t = (await ui.find({ type: 'Text' }))?.text
  await ui.unmount()
  return t
}

test('un rappel part toutes les 50 min de pause, et plus aucun après 7 h', async ($, on) => {
  const { clock, rappels } = moteur(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await unTour($)
  expect(await bandeau($)).toBe("Cache au chaud · maintenu jusqu'à " + new Date(clock.now() + 7 * 60 * MIN).toTimeString().slice(0, 5))

  await clock.advance(49 * MIN)
  expect(rappels.length).toBe(0)
  await clock.advance(2 * MIN)
  expect(rappels.length).toBe(1)
  expect(await bandeau($)).toMatch(/· 1 rappel$/)

  await clock.advance(7 * 60 * MIN)
  const n = rappels.length
  expect(n).toBe(8) // un toutes les 50 min sur 7 h
  await clock.advance(3 * 60 * MIN)
  expect(rappels.length).toBe(n)
})

test("le cache expire une heure après le dernier rappel, et l'alerte dit ce que coûte la reprise", async ($, on) => {
  const { clock, toasts } = moteur(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await unTour($)
  await clock.advance(8 * 60 * MIN)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('300k tokens (≈ 2,40 $)')
  expect(await bandeau($)).toBe('Cache expiré · la prochaine question réécrit 300k tokens (≈ 2,40 $)')

  await unTour($) // reprendre réarme le maintien
  expect(await bandeau($)).toMatch(/^Cache au chaud/)
})

test('une tâche planifiée ne déclenche aucun rappel', async ($, on) => {
  const { clock, rappels } = moteur(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await unTour($, '<scheduled-task name="veille">Lance la veille</scheduled-task>')
  await clock.advance(3 * 60 * MIN)
  expect(rappels.length).toBe(0)
  expect(await bandeau($)).toBe('moteur')
})

test('/cache-chaud envoie un rappel et dit ce qu il a relu', async ($, on) => {
  const { rappels } = moteur(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await unTour($)
  const r = await $.command.run({ command: 'cache-chaud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(rappels.length).toBe(1)
  expect(r.text).toBe('Rappel envoyé : 300k tokens relus en cache, 0k écrits. Le cache repart pour une heure.')
})

test('un rappel qui ne relit rien prévient, puis plus aucun rappel ne part (cache court)', async ($, on) => {
  const { clock, toasts, rappels } = moteur(on, 0)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await unTour($)
  await clock.advance(51 * MIN)
  expect(toasts[0]).toContain('Cache réécrit par un rappel')
  await clock.advance(5 * 60 * MIN)
  expect(rappels.length).toBe(1)
})
