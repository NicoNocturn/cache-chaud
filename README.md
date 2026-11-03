# cache-chaud

Un mod pour Claude Code. Quand tu fais une pause dans une conversation, il garde son cache au chaud jusqu'à 7 h, pour que ta question au retour ne fasse pas réécrire toute la conversation. Quand le cache a quand même expiré, il te le dit avant que tu tapes, avec ce que coûtera la reprise.

*English below.*

## Le problème qu'il règle

Claude Code garde ta conversation en cache une heure. Tant que tu reviens dans l'heure, chaque tour relit ce cache, à un dixième du prix d'entrée, voire moins selon le modèle (0,20 $ par million de tokens sur Opus 5.5). Passé une heure, le cache est perdu, et ta question suivante fait réécrire toute la conversation au prix d'écriture, le double du prix d'entrée (8 $ par million sur Opus 5.5). Pour une conversation de 300k tokens, ça fait environ 2,40 $ pour une seule question.

Sur 30 jours de nos transcripts, 375 reprises après une pause d'une heure ou plus ont fait 31 % de tout ce qui a été écrit en cache.

Une relecture du cache remet son minuteur à zéro sans frais supplémentaires ([doc du cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). Relire la conversation un peu avant l'heure suffit donc à la garder au chaud, pour une fraction du prix d'une réécriture.

## Ce qu'il fait

- **Pendant une pause**, toutes les 50 minutes, il envoie un rappel invisible : la dernière requête de la session, suivie d'une ligne qui demande de répondre « ok ». Le rappel relit le cache sans rien ajouter à ta conversation et sans appeler aucun outil.
- **Au-dessus du prompt**, une ligne discrète : `Cache au chaud · maintenu jusqu'à 21:40 · 2 rappels`.
- **Après 7 h sans activité**, il s'arrête, et le cache s'éteint seul une heure plus tard. Une notification dit alors ce que coûtera la reprise : `la prochaine question réécrit 300k tokens (≈ 2,40 $)`. Si la suite n'a besoin que des conclusions, une session neuve avec un court brief coûte moins.
- **`/cache-chaud`** envoie un rappel tout de suite et dit combien de tokens il a relus en cache : c'est le moyen de vérifier que le mod marche chez toi.

Il ne s'active que dans une session où une personne a écrit (pas une tâche planifiée) et dont le contexte dépasse 100k tokens : en dessous, une réécriture coûte peu. Si le poste s'est mis en veille et que le cache a sans doute déjà expiré, il n'envoie pas de rappel, qui paierait la réécriture pour rien, et passe directement à l'alerte.

## Pourquoi 7 h

Un rappel coûte une relecture du cache. Les rappels envoyés aux sessions que tu ne reprends jamais sont perdus, et plus le plafond est long, plus il y en a. Nous avons rejoué 30 jours de transcripts (sessions où une personne a écrit, contexte d'au moins 100k) pour chaque plafond, de 2 h à 10 h :

- au prix API, avec les relectures comptées, le gain net est le plus haut vers 4 h, reste positif à 7 h, et tombe à zéro vers 10 h ;
- si ton forfait ne compte pas les relectures de cache (une mesure de septembre sur un forfait Max va dans ce sens, une autre les compte au dixième du prix), le gain monte jusqu'à 7 h puis ne bouge plus.

7 h ne perd dans aucun des deux cas, et couvre une journée de travail. Le plafond est la constante `PLAFOND` en tête de `hooks/register.tsx`.

## Ce qu'il suppose

Le cache d'une heure. Pour le vérifier, ouvre un transcript de session (`~/.claude/projects/<projet>/<session>.jsonl`) : un champ `ephemeral_1h_input_tokens` non nul dans `usage.cache_creation` dit que tes sessions écrivent le cache d'une heure. Si ton compte n'a qu'un cache de 5 minutes, le premier rappel le trouve expiré : le mod te prévient et ne relance plus de rappel dans cette session.

Le mod ne peut rien contre un changement de modèle en cours de session : changer de modèle fait toujours réécrire la conversation.

## Installation

1. Clone le repo :

   ```bash
   git clone https://github.com/NicoNocturn/cache-chaud.git
   ```

2. Dans `~/.claude/settings.json`, fais pointer Claude Code vers le dossier :

   ```json
   {
     "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/chemin/vers/cache-chaud" }
   }
   ```

   Si la variable porte déjà un autre mod, ajoute le dossier à la suite, séparé par `;` sous Windows et par `:` ailleurs.

3. Ouvre une nouvelle session, puis tape `/cache-chaud` : la réponse doit dire combien de tokens le rappel a relus en cache.

Pour l'essayer sans toucher à tes réglages : `claude --plugin-dir /chemin/vers/cache-chaud`.

## Tester

```bash
claude plugin validate .
claude plugin test .
```

## English

A Claude Code mod that keeps a conversation's prompt cache warm while you take a break, for up to 7 hours, so that your next question doesn't re-write the whole conversation at the cache-write price. Claude Code caches a conversation for one hour, and a cache read resets that timer. During a pause, every 50 minutes, the mod sends an invisible keep-alive: the session's last request again, plus one line asking for "ok", with no tools and nothing added to your transcript. A dim line above the prompt shows the cache state; after 7 hours of inactivity the mod stops, and once the cache has expired a notification shows what resuming will cost. `/cache-chaud` sends a keep-alive now and reports how many tokens it read from cache. It only runs in sessions where a person typed and whose context exceeds 100k tokens. Over 30 days of our transcripts, resuming after a pause of an hour or more accounted for 31% of all cache writes; 7 hours is the cap that never loses, whether or not your plan counts cache reads. It assumes the one-hour cache; on a 5-minute cache the first keep-alive finds it expired and the mod stops for that session. Install: clone, then set `CLAUDE_CODE_PLUGIN_DIRS` to the folder in `~/.claude/settings.json`. The interface text is in French.

## Licence

MIT. Écrit par Nicolas Duvillard.
