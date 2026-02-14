import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { PaperFlowController } from './adapters/controller.js';

export default class PaperFlowExtension extends Extension {
    private _controller: PaperFlowController | undefined;

    enable(): void {
        this._controller = new PaperFlowController(this.getSettings());
        this._controller.enable();
    }

    disable(): void {
        this._controller?.disable();
        this._controller = undefined;
    }
}
