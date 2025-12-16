"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestComponent = void 0;
const react_1 = __importDefault(require("react"));
const TestComponent_module_scss_1 = __importDefault(require("./TestComponent.module.scss"));
const TestComponent = () => {
    return (<div className={TestComponent_module_scss_1.default.container}>
			<h1 className={TestComponent_module_scss_1.default.title}>Test</h1>
			<div className={TestComponent_module_scss_1.default.newClass}>New class test</div>
		</div>);
};
exports.TestComponent = TestComponent;
//# sourceMappingURL=TestComponent.js.map