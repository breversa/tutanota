pipeline {
    environment {
    	// on m1 macs, this is a symlink that must be updated. see wiki.
        VERSION = sh(returnStdout: true, script: "${env.NODE_PATH}/node -p -e \"require('./package.json').version\" | tr -d \"\n\"")
        TMPDIR='/tmp'
    }
	agent {
		node {
			label 'linux'
		}
	}
    stages {
		stage('Check Github') {
			steps {
				dir('/opt/jenkins/jobs/debian-11-container/workspace') {
					sh 'whoami'
					script {
						def util = load "ci/jenkins-lib/util.groovy"
						util.checkGithub()
					}
				}
			}
		}
		stage('docker') {
		agent {
			dockerfile {
				filename 'Desktop.dockerfile'
				label 'master'
				dir 'ci'
				additionalBuildArgs "--format docker"
				args '--network host'
			} // docker
		} // agent
			steps {
				sh 'whoami'
				sh 'node -v'
				sh 'df -h'
				sh 'rustc --version'
				sh 'cargo --version'
			}
		}
		stage('Build dependencies') {
			parallel {
				stage('Build webapp') {
					environment {
						PATH = "${env.NODE_PATH}:${env.PATH}:/home/jenkins/emsdk/upstream/bin/:/home/jenkins/emsdk/:/home/jenkins/emsdk/upstream/emscripten"
					}
					agent {
						dockerfile {
							filename 'Desktop.dockerfile'
							label 'master'
							dir 'ci'
							additionalBuildArgs "--format docker"
							args '--network host'
						} // docker
					} // agent
					steps {
						dir('/opt/jenkins/jobs/debian-11-container/workspace/tutanota-3') {
							sh 'npm ci'
							sh 'npm run build-packages'
							sh 'node webapp.js release'

							// excluding web-specific and mobile specific parts which we don't need in desktop
							stash includes: 'build/**', excludes: '**/braintree.html, **/index.html, **/app.html, **/desktop.html, **/index-index.js, **/index-app.js, **/index-desktop.js, **/sw.js', name: 'web_base'
						}
					}
				}
			}
		}
	} // stages
} // pipeline