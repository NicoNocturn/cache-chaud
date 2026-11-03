import type { EngineInterface, Register } from 'claude-code'

// Le cache des sessions vit une heure ; une relecture remet son minuteur à zéro.
// Plafond mesuré sur 30 jours de transcripts (README) : au-delà de 7 h sans
// activité, les rappels perdus sur les sessions qu'on ne reprend pas coûtent plus
// que les reprises qu'ils sauvent.
const MINUTE = 60_000
const TTL = 60 * MINUTE
const RAPPEL_APRES = 50 * MINUTE // marge : le minuteur part du début de la dernière requête
const TROP_TARD = 58 * MINUTE // au-delà, le cache a sans doute lâché : un rappel paierait la réécriture
const PLAFOND = 7 * 60 * MINUTE
const CONTEXTE_MIN = 100_000 // en dessous, une réécriture coûte peu

// $ par million de tokens écrits en cache 1 h (2 fois le prix d'entrée)
const ECRITURE_1H: [string, number][] = [
  ['fable', 20], ['mythos', 20], ['opus-5-5', 8], ['opus', 10],
  ['sonnet', 4], ['haiku-5-5', 0.2], ['haiku', 2],
]

const RAPPEL =
  "Message technique du mod cache-chaud, envoyé pendant une pause pour garder le cache de cette conversation actif. Ne fais rien d'autre : réponds seulement « ok »."

// L'état de la session ; un rechargement du mod le remet à zéro, le tour suivant le réarme.
const s = {
  humain: false, // au moins un message tapé par une personne (pas une tâche planifiée)
  occupe: false,
  cacheCourt: false, // un rappel a trouvé le cache déjà expiré : ce compte n'a pas le cache d'une heure
  finDeTour: 0, // dernière activité de la personne
  rafraichi: 0, // début de la dernière requête qui a relu ou écrit le cache
  contexte: 0,
  modele: '',
  rappels: 0,
  enCours: false,
  etat: 'libre' as 'chaud' | 'libre' | 'expire',
}

function prixReecriture() {
  const prix = ECRITURE_1H.find(([k]) => s.modele.includes(k))?.[1] ?? 8
  return ((s.contexte * prix) / 1e6).toFixed(2).replace('.', ',')
}

function heure(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function kilo(n: number) {
  return `${Math.round(n / 1000)}k`
}

function expire($: EngineInterface) {
  if (s.etat === 'expire') return
  s.etat = 'expire'
  $.ui.toast(
    `Cache expiré : la prochaine question réécrit ${kilo(s.contexte)} tokens (≈ ${prixReecriture()} $). Si la suite n'a besoin que des conclusions, une session neuve avec un brief coûte moins.`,
    { timeoutMs: 15_000 },
  )
}

async function minute($: EngineInterface) {
  if (!s.humain || s.occupe || s.enCours || s.cacheCourt || s.etat !== 'chaud') return
  const maintenant = await $.clock.now()
  const depuis = maintenant - s.rafraichi
  if (depuis >= TROP_TARD) {
    expire($)
  } else if (maintenant - s.finDeTour > PLAFOND) {
    // plus de rappel : le cache s'éteint seul à la fin de son heure
  } else if (depuis >= RAPPEL_APRES && s.contexte >= CONTEXTE_MIN) {
    const r = await rappel($, maintenant)
    if (r?.isAnswered && r.usage.cache_read_input_tokens < s.contexte / 2) {
      // Le cache avait lâché avant 50 min : le compte n'a pas le cache d'une heure, et chaque
      // rappel réécrirait la conversation. Plus aucun rappel dans cette session.
      s.cacheCourt = true
      $.ui.toast(`Cache réécrit par un rappel (${kilo(r.usage.cache_creation_input_tokens)} tokens) : il avait expiré avant une heure. Ce compte semble sur un cache plus court, les rappels s'arrêtent pour cette session.`, { timeoutMs: 15_000 })
    } else if (r && !r.isAnswered) {
      expire($)
    }
  }
  $.ui.invalidate('ui.render')
}

// Relit la conversation hors du fil : le cache repart pour une heure.
async function rappel($: EngineInterface, maintenant: number) {
  s.enCours = true
  const r = await $.model.fork({ prompt: RAPPEL })
  s.enCours = false
  if (s.occupe) return undefined // la personne a repris pendant le rappel : son tour relit le cache
  if (r.isAnswered) {
    s.rafraichi = maintenant
    s.rappels += 1
    s.etat = 'chaud'
  }
  return r
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(MINUTE, () => void minute($))
    await $.command.register({
      name: 'cache-chaud',
      description: 'Envoie un rappel tout de suite et dit combien de tokens il a relus en cache',
    })
    return next(e)
  })

  on('command.run', { command: 'cache-chaud' }, async $ => {
    if (s.occupe || s.enCours) return { text: 'Un tour ou un rappel tourne déjà : il relit le cache.' }
    const r = await rappel($, await $.clock.now())
    $.ui.invalidate('ui.render')
    if (!r) return { text: 'Rappel interrompu : un tour a démarré.' }
    if (!r.isAnswered) return { text: `Rappel sans réponse (${r.reason}).` }
    const lu = r.usage.cache_read_input_tokens
    const ecrit = r.usage.cache_creation_input_tokens
    return {
      text: lu >= ecrit
        ? `Rappel envoyé : ${kilo(lu)} tokens relus en cache, ${kilo(ecrit)} écrits. Le cache repart pour une heure.`
        : `Le cache avait expiré : ce rappel l'a réécrit (${kilo(ecrit)} tokens écrits, ${kilo(lu)} relus).`,
    }
  })

  on('prompt.submit', ($, e, next) => {
    if (!e.isMeta && !e.command && !e.text.trimStart().startsWith('<')) s.humain = true
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (!e.agentId) s.occupe = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    s.occupe = false
    s.finDeTour = await $.clock.now()
    s.rafraichi = s.finDeTour
    s.rappels = 0
    s.etat = 'chaud'
    s.contexte = (await $.session.usage()).context.tokens ?? s.contexte
    if (r.usage?.model) s.modele = r.usage.model
    $.ui.invalidate('ui.render')
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!s.humain || e.props.hasSurvey || e.props.isWorking || s.etat === 'libre' || s.contexte < CONTEXTE_MIN) return next(e)
    const { Text } = $.ui.resolve(e)
    const maintenant = await $.clock.now()
    let texte: string
    if (s.etat === 'expire') {
      texte = `Cache expiré · la prochaine question réécrit ${kilo(s.contexte)} tokens (≈ ${prixReecriture()} $)`
    } else if (maintenant < s.finDeTour + PLAFOND) {
      const n = s.rappels
      texte = `Cache au chaud · maintenu jusqu'à ${heure(s.finDeTour + PLAFOND)}${n ? ` · ${n} rappel${n > 1 ? 's' : ''}` : ''}`
    } else {
      const reste = Math.max(0, Math.round((s.rafraichi + TTL - maintenant) / MINUTE))
      texte = `Cache : expire dans ${reste} min, plus de rappel après 7 h sans activité`
    }
    return <Text dimColor>{texte}</Text>
  })
}
