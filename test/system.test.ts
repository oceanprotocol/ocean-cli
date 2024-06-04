import 'ts-node/register';
import fetch from 'cross-fetch';
import { expect } from 'chai';

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