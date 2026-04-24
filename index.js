// Bot Discord = pur relais.
// Ne calcule rien, ne stocke rien, ne planifie rien.
// Rôles :
//  1. Rester connecté à Discord (pour pouvoir poster)
//  2. Exposer un serveur HTTP sur API_PORT avec /casier + /notify/* (cf. api-server)
// Toute la logique métier et le scheduling vivent sur le site ron-oil-web.
require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const apiServer = require('./modules/api-server');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

client.once(Events.ClientReady, (readyClient) => {
    console.log(`Bot connecté en tant que ${readyClient.user.tag}`);
    apiServer.start(client);
});

client.login(process.env.DISCORD_TOKEN);
