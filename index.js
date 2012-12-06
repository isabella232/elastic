var moment = require( 'moment' );

process.env.EC2_HOME = __dirname + '/ec2-api-tools-1.6.5.2';
process.env.AWS_CLOUDWATCH_HOME = __dirname + '/CloudWatch-1.0.13.4';
process.env.AWS_ELB_HOME = __dirname + '/ElasticLoadBalancing-1.0.17.0';

var ec2_bin = process.env.EC2_HOME + '/bin/';
var cloudwatch_bin = process.env.AWS_CLOUDWATCH_HOME + '/bin/';
var elb_bin = process.env.AWS_ELB_HOME + '/bin/';

function Ec2() {
}
Ec2.prototype._useCli = function( command, args, parsingRegex, objectParser, callback ) {
	( require( './lib/SpawnProcess' ) )( 
		command, args,
		function( output ) {
			var results = [];
			var dataLines = output.match( new RegExp( parsingRegex, 'g' ) );
			dataLines.forEach( function( line ) {
				var matches = line.match( new RegExp( parsingRegex, '' ) );
				if( matches )
					results.push( objectParser( matches ) );
			});
			callback( null, results );
		},
		function( errors ) {
			callback( errors, null );
		}
	);		
}
//./mon-get-stats CPUUtilization --namespace "AWS/EC2" --statistics "Minimum,Maximum,Average" --headers --period 60 --dimensions "InstanceId=i-37211948"
Ec2.prototype.getAverageCPUUtilization = function( region, instanceId, callback ) {
	var newestEntry = null;
	this._useCli( 
		cloudwatch_bin + 'mon-get-stats',
		[ 
			'CPUUtilization',
			'--namespace', '"AWS/EC2"', 
			'--statistics', '"Average"', 
			'--headers' ,
			'--period', 60,
			'--region', region,
			'--dimensions', '"InstanceId=' + instanceId + '"' 
		],
		'([0-9\-]+ [0-9:]+) +([0-9\.]+) +Percent',
		function( matches ) {
			var date = moment( matches[1] );
			if( !newestEntry || date.valueOf() > newestEntry.timestamp )
				newestEntry = {
					"timestamp": date.valueOf(),
					"percent": matches[2]
				};
			return 0;
		},
		function( error, result ) {
			callback( error, newestEntry.percent );
		} );
}
Ec2.prototype.getElasticLoadBalancers = function( region, callback ) {
	this._useCli( 
		elb_bin + 'elb-describe-lbs',
		[ 
			'--region', region
		],
		'LOAD_BALANCER +([A-Za-z0-9\-]+) +([A-Za-z0-9\-\.]+)',
		function( matches ) {
			return {
				"name": matches[1],
				"external": matches[2]
			}
		},
		callback );
}
Ec2.prototype.getBalancedInstances = function( region, balancerName, callback ) {
	this._useCli(
		elb_bin + 'elb-describe-instance-health',
		[ 
			balancerName,
			'--region', region
		],
		'INSTANCE_ID +([A-Za-z0-9\-]+) +([A-Za-z0-9\-\.]+)',
		function( matches ) {
			return {
				"instance": matches[1],
				"state": matches[2]
			};
		},
		callback );		
}
Ec2.prototype.getRunningInstances = function( region, callback ) {
	this._useCli(
		ec2_bin + 'ec2-describe-instances',
		[ '--region', region ],
		'INSTANCE\t([A-Za-z0-9\-]+)\t([A-Za-z0-9\-]+)\t([A-Za-z0-9\-\.]+)\t([A-Za-z0-9\-\.]+)',
		function( matches ) {
			return {
				"instance": matches[1],
				"ami": matches[2],
				"external": matches[3],
				"internal": matches[4]
			};
		},
		callback );
}
Ec2.prototype.getAMIs = function( region, callback ) {
	this._useCli(
		ec2_bin + 'ec2-describe-images',
		[ '--region', region ],
		'IMAGE\t([A-Za-z0-9\-]+)\t([A-Za-z0-9\-\/ ]+)\t([A-Za-z0-9\-]+)\t([A-Za-z0-9\-]+)',
		function( matches ) {
			return {
				"ami": matches[1],
				"name": matches[2],
				"state": matches[4]
			};
		},
		callback );
}
Ec2.prototype.terminateInstance = function( region, instance, callback ) {
	var self = this;
	( require( './lib/SpawnProcess' ) )( 
		ec2_bin + 'ec2-terminate-instances',
		[ '--region', region, instance ],
		function( output ) {
			var retry = 0;
			function checkTerminated() {
				self.getRunningInstances( region, function( error, instances ) {
					var found = false;
					instances.forEach( function( foundInstance ) {
						if( foundInstance.instance == instance )
							found = true;
					});

					if( !found )
						callback( null );
					else
					{
						retry++;
						if( retry < 12 )
							setTimeout( checkTerminated, 5000 );
						else
							callback( 'Instance took too long to terminate: ' + instance );
					}
				});
			}
			setTimeout( checkTerminated, 5000 );
		},
		function( errors ) {
			callback( errors );
		}
	);	
}
Ec2.prototype.launchInstance = function( region, image, keypair, type, callback ) {
	this._useCli(
		ec2_bin + 'ec2-run-instances',
		[ '--region', region, '-n', 1, '-k', keypair, '-t', type, image ],
		'INSTANCE\t([A-Za-z0-9\-]+)',
		function( matches ) {
			return {
				"instance": matches[1],
			};
		},
		callback );
}
module.exports = exports = new Ec2();