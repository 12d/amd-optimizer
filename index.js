var parse = require('./source/parse');
var locateModules = require('./source/locateModules');
var findDependencies = require('./source/findDependencies');
var nameAnonymousModule = require('./source/nameAnonymousModule');
var print = require('./source/print');
var moduleTree = require('./source/moduleTree');
var missingModules = require('./source/missingModules');
var path = require('path');
var url = require('url');
var requirejs = require('requirejs');
var EventEmitter = require('events').EventEmitter;
var slash = require('slash');
var _ = require('lodash');


module.exports = function(config, options){

  config = config || {};
  options = options || {};

  var toExclude = getExclude(config, options);

  var context = requirejs(config);

  var modules = moduleTree();

  var pendingModules = missingModules();

  var onDone = null;

  return _.extend(new EventEmitter(), {
    addFile: function(file){
      if('contents' in file == false){
        this.emit('error', 'File object must contain content');
        return;
      }
      if('name' in file == false){
        this.emit('error', 'File object must contain property name');
        return;
      }
      if('relative' in file == false){
        this.emit('error', 'File object must contain property relative');
        return;
      }

      var filename = slash(file.name);
      if(modules.isMissing(filename)){
        pendingModules.remove(filename);

        locateModules(parse(file), options.umd).map(function(module){

          if(module.isModule){
            var moduleName = nameAnonymousModule(module.defineCall, filename);

            var dependencies = findDependencies(module.defineCall).filter(function(name){
              return !excluded(toExclude, name);
            })
            .map(function(name){
              // name = path.relative(config.baseUrl, path.resolve(path.parse(slash(file.path)).dir, context.toUrl(name)));
              // console.log('abs name', path.parse(slash(file.path)).dir, name, path.relative(config.baseUrl,context.toUrl(name)))
              if(hasProtocol(config.baseUrl)){
                return {path: url.resolve(config.baseUrl, context.toUrl(name)) + '.js', name: name, requiredBy: moduleName};
              } else {
				  var moduleID = slash(path.relative(config.baseUrl,path.resolve(path.parse(slash(file.path)).dir,name)));
				  // console.log('module',{path: path.join(config.baseUrl, moduleID) + '.js', name: moduleID, requiredBy: moduleName});
				  // var moduleID = slash(path.relative(config.baseUrl, context.toUrl(name)));
				  // console.log(slash(path.resolve(config.baseUrl, moduleID) + '.js'),'resolve');
                  //将相对当前文件的依赖路径，替换成点对根目录
				  file.contents = new Buffer(String(file.contents).replace(name, moduleID));
                  return {path: moduleID + '.js', name: moduleID, requiredBy: moduleName, file: file};
              }
            });
          }else{
            var dependencies = [];
            var moduleName = filename;
          }
          /*根据修改后的文件重新生成语法数*/
          var newnode = parse(file).program.body[1];
          //替换原来的语法树
          module.rootAstNode = newnode;
          module.defineCall = newnode.expression;
          //给模块加上模块id, 例如 define([],fn) => define('moduleID', [], fn)
          nameAnonymousModule(module.defineCall, filename);
          modules.defineModule(moduleName, module.rootAstNode, dependencies.map(function(dep){ return dep.name; }), file);

          return dependencies;

        }).reduce(function(a, b){
          return a.concat(b);
        }, []).forEach(function(dependency){
          if(modules.has(dependency.name) || pendingModules.has(dependency.name)){
            return;
          }

          pendingModules.add(dependency.name, dependency);
          if(onDone){
            this.emit('dependency', dependency);
          }
        }, this);
      }

      if(pendingModules.isEmpty()){
        onDone && onDone();
      }else{
      }
    },
    done: function(done){
      if(pendingModules.isEmpty()){
        done(optimize());
      }else{
        pendingModules.forEach(function(module){
          // console.log('module', module)
          this.emit('dependency', module);
        }.bind(this));
		  // console.log('not empty',pendingModules.isEmpty(),pendingModules)
        onDone = function(){
          done(optimize());
        };
      }
    },
    error: function(err){
      this.emit('error', err);
    }
  });

  function optimize(){
    return modules.leafToRoot().map(function(module){
      // console.log('module', module)
      var code = print(module.source, module.name, module.file.sourceMap);
		if(module.name.indexOf('mediarecorder')>-1){
			console.log(JSON.stringify(module.source[1]),'module')
		}
      return {
        content: code.code,
        map: code.map,
        name: slash(module.name),
        source: module.file.source,
        file: module.file
      };
    });
  }

  // match to "http://", "https://", etc...
  function hasProtocol(targetUrl){
    return /^[a-z]+:\/\//.test(targetUrl);
  }

};

function excluded(exclude, name){
  var path = name.split('/');
  return exclude.some(function(prefix){
    var prefixPath = prefix.split('/');
    if(prefixPath.length > path.length) return false;
    var startOfPath = _.take(path, prefixPath.length);
    return _.zip(startOfPath, prefixPath).every(function(segment){
      return segment[0] === segment[1];
    });
  });
}

function getExclude(config, options){
  if('exclude' in config && 'exclude' in options){
    return _.uniq(config.exclude.concat(options.exclude))
  }else if('exclude' in config){
    return config.exclude;
  }else if('exclude' in options){
    return options.exclude;
  }else{
    return [];
  }
}