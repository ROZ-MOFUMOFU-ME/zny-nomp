import { EventEmitter } from 'events';
import net from 'net';

const listener = function (this: any, port: number) {
    const _this = this;

    const emitLog = function (text: string) {
        _this.emit('log', text);
    };

    this.start = function () {
        net.createServer(function (c) {
            let data = '';
            try {
                c.on('data', function (d) {
                    data += d;
                    if (data.slice(-1) === '\n') {
                        const message = JSON.parse(data);
                        _this.emit(
                            'command',
                            message.command,
                            message.params,
                            message.options,
                            function (reply: string) {
                                c.end(reply);
                            }
                        );
                    }
                });
                c.on('end', function () {});
                c.on('error', function () {});
            } catch (e) {
                emitLog('CLI listener failed to parse message ' + data);
            }
        }).listen(port, '127.0.0.1', function () {
            emitLog('CLI listening on port ' + port);
        });
    };
};

(listener as any).prototype.__proto__ = EventEmitter.prototype;

export default listener;
