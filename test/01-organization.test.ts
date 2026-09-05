import axios from 'axios';

import { app } from '../src/app';
import sequelize, { QueryTypes } from "../src/utils/db";
import Config from '../src/config'
import { StatusCodes } from 'http-status-codes';

const packageJson = require('../package.json');

describe('Organization Tests', () => {

  let api;
  let server;
  let token;

  beforeAll(async () => {
    server = await app(0);
    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => { return true; }
    });
  });

  afterAll(async() => {
    server.close();
  });

  it('Should return the version from package.json', async () => {
    const response = await api.get(`/version`);
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ version: packageJson.version });
  });

  it('Should log in and get an access token', async () => {
    let response = await api.post(`/organization/login`, {
      name: 'pergamo',
      password: Config.password_master,
    });

    expect(response.status).toBe(200);
    expect(response.data.token).toBeDefined();

    token = response.data.token;
  });

  it('Should change password', async () => {
    
    let response = await api.post(`/organization/changePassword`, { password: 'Test0123456#' }, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.message).toBe('Password change successfully');

    response = await api.post(`/organization/changePassword`, { password: Config.password_master }, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.message).toBe('Password change successfully');

    response = await api.post(`/organization/changePassword`, { password: Config.password_master }, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    expect(response.data.error).toBe('Password is the same');
  });

  it('Should unchange password', async () => {
    
    const response = await api.post(`/organization/changePassword`, { password: 'test' }, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });

  it('Should create organization from master', async () => {

    let response = await api.post(`/organization/login`, {
      name: Config.user_master,
      password: Config.password_master,
    });

    const tokenMaster = response.data.token;
    
    response = await api.post(`/organization/master/create`, 
      { 
        name: 'test',
        password: Config.password_master
      }, 
      {
        headers: {
          'authorization': tokenMaster
        }
      }
    );

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data).toBeDefined();

    await sequelize.query("DELETE FROM pergamo.organization WHERE id = :organization;", {
      replacements: { organization: response.data.id },
      type: QueryTypes.SELECT
    });
  });

  it('Should change password from master', async () => {

    let response = await api.post(`/organization/login`, {
      name: Config.user_master,
      password: Config.password_master,
    });

    const tokenMaster = response.data.token;
    
    response = await api.post(`/organization/master/changePassword`, 
      { 
        organization: 'pergamo',
        password: 'Test0123456#' 
      }, 
      {
        headers: {
          'authorization': tokenMaster
        }
      }
    );

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.message).toBe('Password change successfully');

    response = await api.post(`/organization/master/changePassword`, 
      { 
        organization: 'pergamo',
        password: Config.password_master
      }, 
      {
        headers: {
          'authorization': tokenMaster
        }
      }
    );

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.message).toBe('Password change successfully');
  });
});