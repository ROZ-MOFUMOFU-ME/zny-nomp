import https from 'https';
import fs from 'fs';
import path from 'path';
import express from 'express';
import compress from 'compression';
import api from './api.ts';
import type { Logger } from './logUtil.ts';

// Directory of the built Vite + React SPA (see web/). Everything the browser
// loads — the app, its assets, and the static key.html wallet tool (web/public/
// key.html) — is served from here, with a catch-all fallback to index.html so
// client-side routes work.
const SPA_DIR = path.resolve('web/dist');
const SPA_INDEX = path.join(SPA_DIR, 'index.html');

export default function (this: any, logger: Logger) {
    var portalConfig: any = JSON.parse(process.env.portalConfig as string);
    var poolConfigs: any = JSON.parse(process.env.pools as string);

    var websiteConfig = portalConfig.website;

    var portalApi: any = new (api as any)(logger, portalConfig, poolConfigs);
    var portalStats = portalApi.stats;

    var logSystem = 'Website';

    // Populate the stats snapshot once at startup so /api/stats has data before
    // the first SSE tick, then push the live object to SSE clients on a timer.
    portalStats.getGlobalStats(function () {});

    var buildUpdatedWebsite = function () {
        portalStats.getGlobalStats(function () {
            var statData =
                'data: ' + JSON.stringify(portalStats.stats) + '\n\n';
            for (var uid in portalApi.liveStatConnections) {
                var res = portalApi.liveStatConnections[uid];
                res.write(statData);
            }
        });
    };

    setInterval(buildUpdatedWebsite, websiteConfig.stats.updateInterval * 1000);

    var app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(compress());

    // JSON / SSE API.
    app.get('/api/:method', function (req, res, next) {
        portalApi.handleApiRequest(req, res, next);
    });

    app.post('/api/admin/:method', function (req, res, next) {
        if (
            portalConfig.website &&
            portalConfig.website.adminCenter &&
            portalConfig.website.adminCenter.enabled
        ) {
            if (portalConfig.website.adminCenter.password === req.body.password)
                portalApi.handleAdminApiRequest(req, res, next);
            else res.status(401).json({ error: 'Incorrect Password' });
        } else next();
    });

    // Built SPA assets + static files (index.html at /, hashed assets under
    // /assets, the wallet tool at /key.html — all from web/dist via web/public).
    app.use(express.static(SPA_DIR));

    // SPA fallback: any other GET serves the app shell for client-side routing.
    app.use(function (req: any, res: any) {
        res.sendFile(SPA_INDEX);
    });

    app.use(function (err: any, req: any, res: any, next: any) {
        console.error(err.stack);
        res.status(500).send('Something broke!');
    });

    try {
        if (
            portalConfig.website.tlsOptions &&
            portalConfig.website.tlsOptions.enabled === true
        ) {
            var TLSoptions = {
                key: fs.readFileSync(portalConfig.website.tlsOptions.key),
                cert: fs.readFileSync(portalConfig.website.tlsOptions.cert)
            };

            https
                .createServer(TLSoptions, app)
                .listen(
                    portalConfig.website.port,
                    portalConfig.website.host,
                    function () {
                        logger.debug(
                            logSystem,
                            'Server',
                            'TLS Website started on ' +
                                portalConfig.website.host +
                                ':' +
                                portalConfig.website.port
                        );
                    }
                );
        } else {
            app.listen(
                portalConfig.website.port,
                portalConfig.website.host,
                function () {
                    logger.debug(
                        logSystem,
                        'Server',
                        'Website started on ' +
                            portalConfig.website.host +
                            ':' +
                            portalConfig.website.port
                    );
                }
            );
        }
    } catch (e) {
        console.log(e);
        logger.error(
            logSystem,
            'Server',
            'Could not start website on ' +
                portalConfig.website.host +
                ':' +
                portalConfig.website.port +
                ' - its either in use or you do not have permission'
        );
    }
}
