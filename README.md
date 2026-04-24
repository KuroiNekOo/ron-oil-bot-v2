# Ron Bot

Pur relais Discord pour Ron Oil. Toute la logique métier (calculs hebdos, paliers, alertes, cron) vit côté site web `ron-oil-web`. Le bot se contente d'exécuter les actions Discord qu'on lui demande via HTTP.

## Installation

```bash
npm install
cp .env.example .env  # puis remplir les valeurs
npm start
```

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `DISCORD_TOKEN` | oui | Token du bot Discord |
| `GUILD_ID` | non | ID du serveur Discord. Si vide, utilise la première guild. |
| `API_PORT` | non | Port du serveur HTTP interne (défaut 3001) |
| `API_SECRET` | oui | Shared-secret, doit correspondre à `BOT_API_SECRET` côté web |
| `EMPLOYEE_CATEGORY_ID` | oui | Catégorie Discord où créer les salons casiers |
| `EMPLOYEE_ROLE_ID` | non | Rôle attribué à la création de casier |
| `VISITOR_ROLE_ID` | non | Rôle retiré à la création de casier |
| `SECURITY_CHANNEL_ID` | oui | Salon où poster les alertes de contrat |
| `PANEL_URL` | non | URL affichée dans le message de bienvenue (défaut `http://localhost:3000/login`) |
| `CURRENCY_SYMBOL` | non | Symbole monétaire dans les embeds (défaut `€`) |

## Endpoints HTTP exposés

Tous les endpoints requièrent le header `x-api-secret: <API_SECRET>`.

### `POST /casier`
Crée un salon privé dans `EMPLOYEE_CATEGORY_ID`, attribue les rôles et y poste les identifiants.

```json
{
  "discordId": "1284164934938136679",
  "firstName": "Jean",
  "lastName": "Dupont",
  "username": "jean.dupont",
  "password": "xxx"
}
```
→ `{ "channelId": "1234..." }`

### `POST /notify/weekly-stats`
Poste les embeds de fin de semaine dans le casier de chaque employé. Appelé automatiquement par le web chaque dimanche à `PERIOD_START_HOUR`.

```json
{
  "week": 13,
  "year": 2026,
  "period": { "startDate": "...", "endDate": "..." },
  "employees": [
    { "channelId": "...", "name": "...", "iban": "...", "stats": { ... } }
  ]
}
```

### `POST /notify/contract-alert`
Poste les alertes de contrats expirants dans `SECURITY_CHANNEL_ID`. Appelé périodiquement par le web.

```json
{
  "alerts": [
    { "name": "Jean Dupont", "endDate": "2026-05-01T18:00:00.000Z", "status": "expiring" }
  ]
}
```

## Architecture

```
┌────────────┐   HTTP (api-server:3001)    ┌──────────────┐
│ ron-oil-web│ ───────────────────────────▶│  ron-bot-v2  │───▶ Discord
└────────────┘  /casier, /notify/*          └──────────────┘
```

Le bot ne fait **aucune** requête HTTP vers le web, ne lit aucun Google Sheet, n'a ni commande texte, ni scheduler, ni cache. Pour toute modification de la logique métier, éditer le site web.
