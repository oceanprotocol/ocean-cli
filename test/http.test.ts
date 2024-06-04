import 'ts-node/register';
import fetch from 'cross-fetch';
import { expect, assert } from 'chai';

describe('Ocean Node Root Endpoint', () => {
  it('should return 200 OK', async () => {
    const response = await fetch('http://localhost:8000/');
    const responseBody = await response.json();

    expect(response.status).to.equal(200);
    expect(responseBody).to.have.property('chainIds');
    expect(responseBody).to.have.property('providerAddress');
    expect(responseBody).to.have.property('serviceEndpoints');
    expect(responseBody).to.have.property('software');
    expect(responseBody).to.have.property('version');

    // You can also check the values of the properties
    expect(responseBody.software).to.equal('Ocean-Node');
    
    // Check if version is "0.0.1" or greater
    const [major, minor, patch] = responseBody.version.split('.').map(Number);
    expect(major).to.be.at.least(0);
    if (major === 0) {
      expect(minor).to.be.at.least(0);
      if (minor === 0) {
        expect(patch).to.be.at.least(1);
      }
    }
  });
});


describe('Direct Command Endpoint', () => {

  it('should return correct status', async () => {
    const response = await fetch('http://localhost:8000/directCommand', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ command: 'status' })
    });
    const responseBody = await response.json();
  
    expect(response.status).to.equal(200);
    expect(responseBody).to.have.property('id');
    expect(responseBody).to.have.property('publicKey');
    expect(responseBody).to.have.property('address');
    expect(responseBody).to.have.property('version');
    expect(responseBody).to.have.property('http');
    expect(responseBody).to.have.property('p2p');
    expect(responseBody).to.have.property('provider');
    expect(responseBody).to.have.property('indexer');
    expect(responseBody).to.have.property('supportedStorage');
    expect(responseBody).to.have.property('uptime');
    expect(responseBody).to.have.property('platform');
    expect(responseBody).to.have.property('codeHash');
    expect(responseBody).to.have.property('allowedAdmins');
  
    // Check the values of some of the properties
    expect(responseBody.http).to.be.true;
    expect(responseBody.p2p).to.be.true;
  });
});


describe('getOceanPeers Endpoint', () => {

  it('should return correct status', async () => {
    const response = await fetch('http://localhost:8000/getOceanPeers');
    const responseBody = await response.json();

    expect(response.status).to.equal(200);
    expect(responseBody).to.be.an('array');
  });
});

describe('Direct Command Endpoint', () => {

  it('should return correct status', async () => {
    const response = await fetch('http://localhost:8000/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const responseBody = await response.text();
  
    expect(response.status).to.equal(400);
    assert(responseBody === "Missing signature")
  });
});