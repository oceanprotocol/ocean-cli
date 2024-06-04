import 'ts-node/register';
import fetch from 'cross-fetch';
import { expect } from 'chai';

describe('Ocean Node Root Endpoint', () => {
  it('should return 200 OK', async () => {
    const response = await fetch('http://localhost:8000/');
    console.log('response: ', response)
    expect(response.status).to.equal(200);
  });
});
