// Adapted from:
// Blanket https://github.com/alex-seville/blanket, copyright (c) 2013 Alex Seville, MIT licensed
// Falafel https://github.com/substack/node-falafel, copyright (c) James Halliday, MIT licensed


// Load modules

var Fs = require('fs');
var Path = require('path');
var Esprima = require('esprima');


// Declare internals

var internals = {};


exports.instrument = function () {

    var currentDir = process.cwd().replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
    var filterPattern = '^' + currentDir + '\\/((?!node_modules|test).).*$';
    var pattern = new RegExp(filterPattern, 'i');

    var origLoader = require.extensions['.js'];
    require.extensions['.js'] = function (localModule, filename) {

        var originalFilename = filename;
        filename = filename.replace(/\\/g, '/');

        if (!pattern.test(filename)) {
            return origLoader(localModule, originalFilename);
        }

        var baseDirPath = Path.dirname(filename).replace(/\\/g, '/') + '/.';

        var instrumented = internals.instrument(filename);
        instrumented = instrumented.replace(/require\s*\(\s*("|')\./g, 'require($1' + baseDirPath);
        localModule._compile(instrumented, originalFilename);
    };
};


internals.instrument = function (filename) {

    var file = Fs.readFileSync(filename, 'utf8');
    var content = file.replace(/^\#\!.*/, '');

    var branching = [];
    var chunks = content.split('');

    var annotate = function (node, parent) {

        // Decorate node

        node.parent = parent;

        node.source = function () {

            return chunks.slice(node.range[0], node.range[1]).join('');
        };

        node.set = function (s) {

            chunks[node.range[0]] = s;
            for (var i = node.range[0] + 1, il = node.range[1]; i < il; i++) {
                chunks[i] = '';
            }
        };

        // Recursively annotate the tree from the inner-most out

        Object.keys(node).forEach(function (key) {

            if (key === 'parent') {
                return;
            }

            var children = [].concat(node[key]);
            children.forEach(function (child) {

                if (child && typeof child.type === 'string') {              // Identify node types
                    annotate(child, node);
                }
            });
        });

        // Annotate source code

        var decoratedTypes = [
            'IfStatement',
            'WhileStatement',
            'DoWhileStatement',
            'ForStatement',
            'ForInStatement',
            'WithStatement'
        ];

        if (decoratedTypes.indexOf(node.type) !== -1) {
            if (node.alternate &&
                node.alternate.type !== 'BlockStatement') {

                node.alternate.set('{' + node.alternate.source() + '}');
            }

            var consequent = node.consequent || node.body;
            if (consequent &&
                consequent.type !== 'BlockStatement') {

                consequent.set('{' + consequent.source() + '}');
            }
        }

        var trackedTypes = [
            'ExpressionStatement',
            'BreakStatement',
            'ContinueStatement',
            'VariableDeclaration',
            'ReturnStatement',
            'ThrowStatement',
            'TryStatement',
            'FunctionDeclaration',
            'IfStatement',
            'WhileStatement',
            'DoWhileStatement',
            'ForStatement',
            'ForInStatement',
            'SwitchStatement',
            'WithStatement'
        ];

        if (trackedTypes.indexOf(node.type) !== -1 &&
            node.parent.type !== 'LabeledStatement' &&
            (node.type !== 'VariableDeclaration' || (node.parent.type !== 'ForStatement' && node.parent.type !== 'ForInStatement'))) {

            node.set('__$$labLine(\'' + filename + '\',' + node.loc.start.line + ');' + node.source());
        }

        if (node.type === 'ConditionalExpression') {
            var line = node.loc.start.line;
            var column = node.loc.start.column;

            branching.push({
                line: line,
                column: column,
                file: filename,
                consequent: JSON.stringify(node.consequent.loc),
                alternate: JSON.stringify(node.alternate.loc)
            });

            node.set('__$$labBranch(\'' + filename + '\',' + line + ',' + column + ',' + node.test.source() + ') ?' + node.consequent.source() + ':' + node.alternate.source());
        }
    };

    annotate(Esprima.parse(content, { loc: true, comment: true, range: true }));

    // Generate preamble

    var __$$labLine = function (filename, line) {

        __$$labCov[filename].lines[line] = __$$labCov[filename].lines[line] || 0;
        __$$labCov[filename].lines[line]++;
    };

    var __$$labBranch = function (filename, line, column, source, consequent, alternate) {

        var pos = (source ? 0 : 1);
        __$$labCov[filename].branchData[line][column][pos] = __$$labCov[filename].branchData[line][column][pos] || [];
        __$$labCov[filename].branchData[line][column][pos].push(source);
        return source;
    };

    var preamble =
        'if (typeof __$$labCov === \'undefined\') {' +
            '__$$labCov = {};' +
        '}' +

        'var __$$labLine = ' + __$$labLine.toString() + ';' +
        'var __$$labBranch = ' + __$$labBranch.toString() + ';' +

        '__$$labCov[\'' + filename + '\'] = {' +
            'branchData: [],' +
            'lines: [],' +
            'source: [\'' + file.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/(\r\n|\n|\r)/gm, '\n').split('\n').join('\', \n\'') + '\']' +
        '};'

    branching.forEach(function (item) {

        if (item.file === filename) {
            preamble +=
                '__$$labCov[\'' + filename + '\'].branchData[' + item.line + '] = __$$labCov[\'' + filename + '\'].branchData[' + item.line + '] || [];' +
                '__$$labCov[\'' + filename + '\'].branchData[' + item.line + '][' + item.column + '] = [];' +
                '__$$labCov[\'' + filename + '\'].branchData[' + item.line + '][' + item.column + '].consequent = ' + item.consequent + ';' +
                '__$$labCov[\'' + filename + '\'].branchData[' + item.line + '][' + item.column + '].alternate = ' + item.alternate + ';';
        }
    });

    return preamble + chunks.join('');
};
