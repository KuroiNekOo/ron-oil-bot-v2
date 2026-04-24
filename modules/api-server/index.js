// Serveur HTTP interne du bot : reçoit des ordres du site web et exécute
// uniquement des actions Discord (création de salon, post d'embed). Aucun
// calcul métier ici — les payloads arrivent déjà prêts.
const express = require('express');
const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const DEFAULT_CHANNEL_PERMISSIONS = [
    'ViewChannel',
    'SendMessages',
    'SendMessagesInThreads',
    'CreatePublicThreads',
    'CreatePrivateThreads',
    'EmbedLinks',
    'AttachFiles',
    'AddReactions',
    'UseExternalEmojis',
    'UseExternalStickers',
    'MentionEveryone',
    'ReadMessageHistory',
    'SendTTSMessages',
    'SendVoiceMessages',
];

function slugify(s) {
    return String(s).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function formatDate(dateStr) {
    if (!dateStr) return 'Non définie';
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function buildStatsFields(stat, currency) {
    const fields = [
        { name: 'Livraisons', value: `${stat.livraisons}`, inline: true },
        { name: 'Gain employé', value: `${stat.gainEmploye.toFixed(2)} ${currency}`, inline: true },
        { name: 'Prime', value: `${stat.prime.toFixed(2)} ${currency}`, inline: true },
        { name: 'Notes de frais', value: `+${stat.totalNotesDeFrais.toFixed(2)} ${currency}`, inline: true },
        { name: 'Rapatriements', value: `+${stat.totalRapatriements.toFixed(2)} ${currency}`, inline: true },
        { name: 'Fourrières', value: `-${stat.totalFourrieres.toFixed(2)} ${currency}`, inline: true },
    ];
    if (stat.podiumPlace) {
        const placeEmoji = stat.podiumPlace === 1 ? '🥇' : stat.podiumPlace === 2 ? '🥈' : '🥉';
        fields.push({ name: `${placeEmoji} Prime Podium`, value: `+${stat.primePodium.toFixed(2)} ${currency}`, inline: true });
        if (stat.primePalier > 0) {
            fields.push({ name: `📊 Prime Palier (Niv.${stat.palierLevel})`, value: `+${stat.primePalier.toFixed(2)} ${currency}`, inline: true });
        }
    }
    if (stat.specialBonus && stat.specialBonus > 0) {
        const label = stat.specialBonusReason ? `⭐ Prime spéciale — ${stat.specialBonusReason}` : '⭐ Prime spéciale';
        fields.push({ name: label, value: `+${stat.specialBonus.toFixed(2)} ${currency}`, inline: true });
    }
    fields.push({ name: 'Prime finale', value: `**${stat.primeFinale.toFixed(2)} ${currency}**`, inline: true });
    return fields;
}

function createPaymentEmbed(primeFinale, iban) {
    let message, color;
    if (primeFinale > 0) {
        if (iban) {
            message = `💳 La prime sera versée sur l'IBAN : \`${iban}\``;
            color = 0x00FF00;
        } else {
            message = `⚠️ IBAN manquant pour le versement de la prime`;
            color = 0xFF0000;
        }
    } else if (primeFinale === 0) {
        message = `ℹ️ Aucune prime à verser cette période`;
        color = 0x808080;
    } else {
        message = `📄 L'entreprise vous enverra une facture pour le montant dû`;
        color = 0xFFA500;
    }
    return new EmbedBuilder().setDescription(message).setColor(color);
}

function start(client) {
    const port = parseInt(process.env.API_PORT || '3001');
    const secret = process.env.API_SECRET;
    const guildId = process.env.GUILD_ID;
    const categoryId = process.env.EMPLOYEE_CATEGORY_ID;
    const employeeRoleId = process.env.EMPLOYEE_ROLE_ID;
    const visitorRoleId = process.env.VISITOR_ROLE_ID;
    const securityChannelId = process.env.SECURITY_CHANNEL_ID;
    const panelUrl = process.env.PANEL_URL || 'http://localhost:3000/';
    const currency = process.env.CURRENCY_SYMBOL || '€';

    if (!secret) {
        console.warn('[api-server] API_SECRET absent — serveur API non démarré');
        return;
    }

    const app = express();
    app.use(express.json({ limit: '2mb' }));

    app.use((req, res, next) => {
        if (req.headers['x-api-secret'] !== secret) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    });

    // ── Création d'un casier (salon privé) + envoi des identifiants
    app.post('/casier', async (req, res) => {
        try {
            const { discordId, firstName, lastName, username, password } = req.body || {};
            if (!discordId || !firstName || !lastName) {
                return res.status(400).json({ error: 'discordId, firstName et lastName sont requis' });
            }
            if (!categoryId) {
                return res.status(500).json({ error: 'EMPLOYEE_CATEGORY_ID non configuré' });
            }

            const guild = guildId
                ? (client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null))
                : client.guilds.cache.first();
            if (!guild) return res.status(500).json({ error: 'Guild introuvable' });

            let member;
            try {
                member = await guild.members.fetch(discordId);
            } catch (e) {
                return res.status(400).json({ error: `Utilisateur Discord ${discordId} introuvable dans la guild` });
            }

            const channelName = slugify(`${firstName}-${lastName}`);
            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: categoryId,
            });
            await channel.lockPermissions();

            const allowNames = DEFAULT_CHANNEL_PERMISSIONS.filter(p => PermissionFlagsBits[p] !== undefined);
            await channel.permissionOverwrites.create(
                member,
                Object.fromEntries(allowNames.map(n => [n, true])),
            );

            if (employeeRoleId) {
                try { await member.roles.add(employeeRoleId); }
                catch (e) { console.warn('[api-server] add role employé:', e.message); }
            }
            if (visitorRoleId && member.roles.cache.has(visitorRoleId)) {
                try { await member.roles.remove(visitorRoleId); }
                catch (e) { console.warn('[api-server] remove role visiteur:', e.message); }
            }

            if (username && password) {
                await channel.send({
                    content:
                        `<@${discordId}> Bienvenue chez **Ron Oil** 🛢️\n\n` +
                        `__**Tes identifiants de connexion**__\n` +
                        `• **Nom d'utilisateur :** \`${username}\`\n` +
                        `• **Mot de passe :** \`${password}\`\n` +
                        `• **Page de connexion :** ${panelUrl}\n` +
                        `*Ces identifiants sont personnels, ne les partage avec personne.*\n\n` +
                        `__**Démarches obligatoires**__\n` +
                        `1. **Permis poids lourd (C)** — si tu ne l'as pas déjà, tu dois le passer. ` +
                        `Envoie ensuite une photo du permis dans ce salon.\n` +
                        `2. **Visite médicale** — si elle n'a pas encore été faite, prends rendez-vous et passe-la.\n\n` +
                        `Tant que ces deux démarches ne sont pas validées, tu ne peux pas prendre la route. ` +
                        `En cas de question, contacte la direction.`,
                });
            }

            res.json({ channelId: channel.id });
        } catch (err) {
            console.error('[api-server] POST /casier error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ── Archivage d'un casier : rename <nom>-❌ + swap des rôles employé ↔ visiteur.
    // Appelé quand un salarié est supprimé côté panel web. Best-effort : si le membre
    // a quitté la guild ou si le salon n'existe plus, on répond quand même 200 avec un
    // flag `warning` pour que le panel n'annule pas la suppression côté BDD.
    app.post('/casier/archive', async (req, res) => {
        try {
            const { channelId, discordId, firstName, lastName } = req.body || {};
            if (!channelId && !discordId) {
                return res.status(400).json({ error: 'channelId ou discordId requis' });
            }

            const warnings = [];

            // 1) Rename du salon : prenom-nom-❌ si on a les deux, sinon fallback
            //    sur le nom courant + suffixe. Idempotent.
            if (channelId) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel && typeof channel.setName === 'function') {
                        const current = channel.name || '';
                        let target;
                        if (firstName && lastName) {
                            target = (slugify(`${firstName}-${lastName}`) + '-❌').slice(0, 100);
                        } else if (!current.endsWith('-❌')) {
                            target = (current + '-❌').slice(0, 100);
                        }
                        if (target && current !== target) {
                            await channel.setName(target, 'Employé supprimé côté panel');
                        }
                    } else {
                        warnings.push('Salon introuvable ou non renommable');
                    }
                } catch (e) {
                    warnings.push('Rename salon : ' + e.message);
                }
            }

            // 2) Swap des rôles côté membre (retire employé, remet visiteur)
            if (discordId) {
                try {
                    const guild = guildId
                        ? (client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null))
                        : client.guilds.cache.first();
                    if (!guild) {
                        warnings.push('Guild introuvable');
                    } else {
                        let member = null;
                        try {
                            member = await guild.members.fetch(discordId);
                        } catch {
                            warnings.push('Membre Discord absent de la guild');
                        }
                        if (member) {
                            if (employeeRoleId && member.roles.cache.has(employeeRoleId)) {
                                try { await member.roles.remove(employeeRoleId, 'Employé supprimé côté panel'); }
                                catch (e) { warnings.push('Retrait rôle employé : ' + e.message); }
                            }
                            if (visitorRoleId && !member.roles.cache.has(visitorRoleId)) {
                                try { await member.roles.add(visitorRoleId, 'Employé supprimé côté panel'); }
                                catch (e) { warnings.push('Ajout rôle visiteur : ' + e.message); }
                            }
                        }
                    }
                } catch (e) {
                    warnings.push('Roles : ' + e.message);
                }
            }

            if (warnings.length) {
                console.warn('[api-server] /casier/archive warnings:', warnings.join(' | '));
            }
            res.json({ ok: true, warnings });
        } catch (err) {
            console.error('[api-server] POST /casier/archive error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ── Diffusion des stats hebdo dans les casiers
    // Payload : { week, period:{startDate,endDate}, employees:[{channelId, name, iban, stats}] }
    app.post('/notify/weekly-stats', async (req, res) => {
        const { period, employees } = req.body || {};
        if (!Array.isArray(employees) || !period) {
            return res.status(400).json({ error: 'period et employees requis' });
        }
        let sent = 0, errs = 0;
        for (const e of employees) {
            try {
                const channel = await client.channels.fetch(e.channelId);
                if (!channel) { errs++; continue; }
                const statsEmbed = new EmbedBuilder()
                    .setTitle(`Statistiques de ${e.name}`)
                    .setDescription(`**Période:** ${formatDate(period.startDate)} → ${formatDate(period.endDate)}`)
                    .setColor(e.stats.primeFinale >= 0 ? 0x00FF00 : 0xFF0000)
                    .addFields(buildStatsFields(e.stats, currency))
                    .setTimestamp();
                const paymentEmbed = createPaymentEmbed(e.stats.primeFinale, e.iban);
                await channel.send({ embeds: [statsEmbed, paymentEmbed] });
                sent++;
            } catch (err) {
                console.error(`[api-server] notify/weekly-stats ${e.channelId}:`, err.message);
                errs++;
            }
        }
        res.json({ sent, errors: errs });
    });

    // ── Alertes contrats (expirés / bientôt expirés)
    // Payload : { alerts:[{name, endDate, status}] } (status = expired|expiring)
    app.post('/notify/contract-alert', async (req, res) => {
        const { alerts } = req.body || {};
        if (!Array.isArray(alerts)) return res.status(400).json({ error: 'alerts requis' });
        if (!securityChannelId) return res.status(500).json({ error: 'SECURITY_CHANNEL_ID non configuré' });
        try {
            const channel = await client.channels.fetch(securityChannelId);
            if (!channel) return res.status(500).json({ error: 'Salon sécurité introuvable' });
            let sent = 0;
            for (const a of alerts) {
                const isExpired = a.status === 'expired';
                const embed = new EmbedBuilder()
                    .setTitle(isExpired ? 'Contrat expiré' : 'Contrat arrivant à expiration')
                    .setDescription(isExpired
                        ? `Le contrat de **${a.name}** est expiré !`
                        : `Le contrat de **${a.name}** arrive à son terme.`)
                    .addFields({ name: 'Date de fin', value: formatDate(a.endDate), inline: true })
                    .setColor(isExpired ? 0xFF0000 : 0xFFA500)
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
                sent++;
            }
            res.json({ sent });
        } catch (err) {
            console.error('[api-server] notify/contract-alert:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.listen(port, () => {
        console.log(`[api-server] Ron Oil bot API on http://localhost:${port}`);
    });
}

module.exports = { start };
